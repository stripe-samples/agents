import { DurableObject } from "cloudflare:workers";
import type { RunState } from "./agent";
import type { Env } from "./env";
import { GmailClient } from "./gmail";

type ThreadRow = { thread_id: string; status: string; updated_at: string };

/** A durable outbox bridges Gmail discovery and at-least-once Queue delivery. */
export class Inbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT)",
    );
  }

  async poll(): Promise<string[]> {
    const [cursor] = this.ctx.storage.sql
      .exec<{ token: string | null }>("SELECT token FROM cursor WHERE id = 1")
      .toArray();
    const page = await new GmailClient(this.env).listThreads(cursor?.token ?? undefined);
    this.ctx.storage.transactionSync(() => {
      for (const id of page.threadIds) {
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO threads (thread_id) VALUES (?)", id);
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO cursor (id, token) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token",
        page.nextPageToken ?? null,
      );
    });
    // Keep entries queued until the consumer reports an Agent's durable status.
    // A crash before/after sendBatch can cause another delivery, but cannot lose work.
    const pending = this.ctx.storage.sql
      .exec<{ thread_id: string }>(
        "SELECT thread_id FROM threads WHERE status = 'queued' ORDER BY updated_at, thread_id LIMIT 100",
      )
      .toArray()
      .map((row) => row.thread_id);
    if (pending.length) {
      await this.env.INVOICE_QUEUE.sendBatch(pending.map((threadId) => ({ body: { threadId } })));
    }
    return pending;
  }

  recordStatus(threadId: string, status: RunState["status"]): void {
    // A duplicate delivery can observe an active run; don't let it overwrite a later result.
    this.ctx.storage.sql.exec(
      `UPDATE threads SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE thread_id = ? AND status IN ('queued', 'pending', 'processing')`,
      status,
      threadId,
    );
  }

  listThreads(): ThreadRow[] {
    return this.ctx.storage.sql
      .exec<ThreadRow>("SELECT * FROM threads ORDER BY updated_at DESC, thread_id LIMIT 100")
      .toArray();
  }

  hasThread(threadId: string): boolean {
    return (
      this.ctx.storage.sql.exec("SELECT 1 FROM threads WHERE thread_id = ?", threadId).toArray()
        .length > 0
    );
  }
}
