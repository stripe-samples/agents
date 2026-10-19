import { createHash, timingSafeEqual } from "node:crypto";
import { getAgentByName } from "agents";
import type { Env, ThreadMessage } from "./env";
import { queueMessageSchema, threadIdSchema, validateCredentials } from "./env";

export { InvoicePayer } from "./agent";
export { Inbox } from "./inbox";

function authorized(request: Request, env: Env): boolean {
  if (!env.RUN_AUTH_TOKEN || env.RUN_AUTH_TOKEN.length < 32) return false;
  const header = request.headers.get("Authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${env.RUN_AUTH_TOKEN}`));
}

function inbox(env: Env) {
  return env.Inbox.get(env.Inbox.idFromName("default"));
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!authorized(request, env)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
      });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/run" && request.method === "POST") {
        validateCredentials(env);
        return json({ enqueued: await inbox(env).poll() }, 202);
      }
      if (url.pathname === "/threads" && request.method === "GET") {
        return json({ threads: await inbox(env).listThreads() });
      }
      if (url.pathname.startsWith("/threads/") && request.method === "GET") {
        const id = threadIdSchema.safeParse(url.pathname.slice("/threads/".length));
        if (!id.success || !(await inbox(env).hasThread(id.data)))
          return json({ error: "Thread not found" }, 404);
        return json(await (await getAgentByName(env.InvoicePayer, id.data)).getRun());
      }
      return json({ error: "Not found" }, 404);
    } catch {
      return json(
        { error: "Request failed. Check Worker configuration and provider availability." },
        503,
      );
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    validateCredentials(env);
    await inbox(env).poll();
  },

  async queue(batch: MessageBatch<ThreadMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const parsed = queueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
      }
      const { threadId } = parsed.data;
      try {
        if (!(await inbox(env).hasThread(threadId))) {
          message.ack();
          continue;
        }
        const agent = await getAgentByName(env.InvoicePayer, threadId);
        const run = await agent.processThread();
        await inbox(env).recordStatus(threadId, run.status);
        message.ack();
      } catch {
        // Retry delivery only. processThread's durable guard prevents payment replay.
        message.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env, ThreadMessage>;
