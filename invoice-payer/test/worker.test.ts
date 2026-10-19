import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunState } from "../src/agent";
import type { Env } from "../src/env";
import worker from "../src/index";

const authorization = "Bearer test-only-token-with-at-least-32-characters";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected external request");
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await reset();
});

describe("Worker access", () => {
  it.each(["/run", "/threads", "/threads/test", "/agents/invoice-payer/test"])(
    "requires authentication on %s",
    async (path) => {
      const response = await exports.default.fetch(`https://example.com${path}`);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("fails closed if authentication is unconfigured", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/threads", { headers: { Authorization: "Bearer " } }),
      { ...env, RUN_AUTH_TOKEN: "" } as Env,
    );
    expect(response.status).toBe(401);
  });

  it("does not expose framework RPC, configuration, or ledger deletion routes", async () => {
    for (const path of ["/agents/invoice-payer/test", "/app-config", "/processed-threads"]) {
      expect(
        (
          await exports.default.fetch(`https://example.com${path}`, {
            headers: { Authorization: authorization },
          })
        ).status,
      ).toBe(404);
    }
  });

  it("returns thread status without connecting to external services", async () => {
    const response = await exports.default.fetch("https://example.com/threads", {
      headers: { Authorization: authorization },
    });
    expect(await response.json()).toEqual({ threads: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("durable payment replay protection", () => {
  it.each<RunState["status"]>(["processing", "completed", "needs_review"])(
    "does not repeat a %s run after eviction",
    async (status) => {
      const agent = await getAgentByName(env.InvoicePayer, "thread1");
      await runInDurableObject(agent, (instance) => {
        instance.setState({ ...instance.state, status, startedAt: "2026-10-19T00:00:00Z" });
      });
      await evictDurableObject(agent);
      const restored = await getAgentByName(env.InvoicePayer, "thread1");
      expect((await restored.processThread()).status).toBe(status);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("records a failed run and refuses subsequent deliveries", async () => {
    const agent = await getAgentByName(env.InvoicePayer, "thread1");
    const first = await agent.processThread();
    expect(first.status).toBe("needs_review");
    const requests = vi.mocked(fetch).mock.calls.length;
    expect(requests).toBe(1);
    expect(await agent.processThread()).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(requests);
  });

  it("does not let an older delivery overwrite a completed status", async () => {
    const inbox = env.Inbox.get(env.Inbox.idFromName("default"));
    await runInDurableObject(inbox, (_instance, state) => {
      state.storage.sql.exec("INSERT INTO threads (thread_id) VALUES ('thread1')");
    });
    await inbox.recordStatus("thread1", "completed");
    await inbox.recordStatus("thread1", "processing");
    expect((await inbox.listThreads())[0]?.status).toBe("completed");
  });
});
