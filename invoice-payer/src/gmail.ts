import { z } from "zod";
import type { Env } from "./env";
import { threadIdSchema } from "./env";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_THREAD_CHARACTERS = 100_000;
const MAX_THREAD_MESSAGES = 50;

const partSchema = z.object({
  mimeType: z.string(),
  filename: z.string().default(""),
  body: z
    .object({
      data: z.string().optional(),
      attachmentId: z.string().optional(),
      size: z.number().int().nonnegative().default(0),
    })
    .default({ size: 0 }),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  get parts() {
    return z.array(partSchema).default([]);
  },
});
type MessagePart = z.infer<typeof partSchema>;

const messageSchema = z.object({
  id: threadIdSchema,
  threadId: threadIdSchema,
  internalDate: z.string().regex(/^\d+$/),
  snippet: z.string().default(""),
  payload: partSchema,
});

type PdfAttachment = { id: string; filename: string; size: number };
export type GmailMessage = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  pdfAttachments: PdfAttachment[];
};

function standardBase64(data: string): string {
  return data.replace(/-/g, "+").replace(/_/g, "/");
}

function decodeText(data: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(standardBase64(data)), (c) => c.charCodeAt(0)),
  );
}

function flatten(part: MessagePart): MessagePart[] {
  return [part, ...part.parts.flatMap(flatten)];
}

/** A client is scoped to one poll or thread run; OAuth tokens stay in memory. */
export class GmailClient {
  private token?: Promise<string>;
  private attachments = new Map<string, { messageId: string; part: MessagePart }>();

  constructor(private readonly env: Env) {}

  private async accessToken(): Promise<string> {
    this.token ??= (async () => {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: this.env.GOOGLE_CLIENT_ID,
          client_secret: this.env.GOOGLE_CLIENT_SECRET,
          refresh_token: this.env.GOOGLE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
      return z.object({ access_token: z.string().min(1) }).parse(await response.json())
        .access_token;
    })();
    return this.token;
  }

  private async get(path: string, params?: URLSearchParams): Promise<unknown> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
    url.search = params?.toString() ?? "";
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status})`);
    return response.json();
  }

  async listThreads(pageToken?: string): Promise<{ threadIds: string[]; nextPageToken?: string }> {
    const { labels } = z
      .object({
        labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
      })
      .parse(await this.get("labels"));
    const label = labels.find((item) => item.name === this.env.GMAIL_LABEL);
    if (!label) throw new Error("GMAIL_LABEL does not match an existing Gmail label");

    // Use an exact label ID instead of interpolating a label into Gmail's query language.
    const params = new URLSearchParams({ labelIds: label.id, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const result = z
      .object({
        messages: z.array(z.object({ threadId: threadIdSchema })).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(await this.get("messages", params));
    return {
      threadIds: [...new Set(result.messages.map((m) => m.threadId))],
      nextPageToken: result.nextPageToken,
    };
  }

  async getThread(threadId: string): Promise<GmailMessage[]> {
    threadIdSchema.parse(threadId);
    const { messages } = z
      .object({
        messages: z.array(messageSchema).min(1).max(MAX_THREAD_MESSAGES),
      })
      .parse(await this.get(`threads/${threadId}`, new URLSearchParams({ format: "full" })));
    this.attachments.clear();
    const result = messages.map((message) => {
      if (message.threadId !== threadId)
        throw new Error("Gmail returned a message from another thread");
      const parts = flatten(message.payload);
      const pdfAttachments: PdfAttachment[] = [];
      for (const [index, part] of parts.entries()) {
        if (part.mimeType !== "application/pdf" && !part.filename.toLowerCase().endsWith(".pdf"))
          continue;
        // Local IDs also support inline PDF bodies. The model never supplies Gmail resource IDs.
        const id = `${message.id}:${index}`;
        this.attachments.set(id, { messageId: message.id, part });
        pdfAttachments.push({ id, filename: part.filename || "invoice.pdf", size: part.body.size });
      }
      const body = parts
        .filter((p) => p.mimeType === "text/plain" && p.body.data)
        .map((p) => decodeText(p.body.data ?? ""))
        .join("\n");
      const header = (name: string) =>
        message.payload.headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
      return {
        id: message.id,
        from: header("from"),
        subject: header("subject"),
        receivedAt: new Date(Number(message.internalDate)).toISOString(),
        body,
        pdfAttachments,
      };
    });
    if (JSON.stringify(result).length > MAX_THREAD_CHARACTERS)
      throw new Error("Thread exceeds the text limit; review manually");
    return result;
  }

  async getPdf(id: string): Promise<string> {
    const attachment = this.attachments.get(id);
    if (!attachment)
      throw new Error("Read the thread first and use an attachment ID from that thread");
    const { part, messageId } = attachment;
    if (part.body.size > MAX_PDF_BYTES) throw new Error("PDF exceeds the 10 MiB limit");
    let data = part.body.data;
    if (!data && part.body.attachmentId) {
      const result = z
        .object({ data: z.string(), size: z.number().nonnegative() })
        .parse(
          await this.get(
            `messages/${messageId}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
          ),
        );
      if (result.size > MAX_PDF_BYTES) throw new Error("PDF exceeds the 10 MiB limit");
      data = result.data;
    }
    if (!data || data.length > Math.ceil(MAX_PDF_BYTES / 3) * 4)
      throw new Error("PDF is missing or too large");
    const base64 = standardBase64(data);
    if (!atob(base64.slice(0, 8)).startsWith("%PDF-")) throw new Error("Attachment is not a PDF");
    return base64;
  }
}
