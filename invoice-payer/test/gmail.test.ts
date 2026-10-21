import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { GmailClient } from "../src/gmail";

const fetchMock = vi.fn<typeof fetch>();
const pdf = btoa("%PDF-1.7\nexample");
const message = {
  id: "message1",
  threadId: "thread1",
  internalDate: "1700000000000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [{ name: "Subject", value: "Invoice 123" }],
    parts: [
      { mimeType: "text/plain", body: { data: btoa("Pay USD 12.00") } },
      {
        mimeType: "application/pdf",
        filename: "invoice.pdf",
        body: { attachmentId: "attachment1", size: 20 },
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected external request"));
});
afterEach(() => vi.unstubAllGlobals());

function token() {
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "token" }));
}

describe("Gmail invoice input", () => {
  it("uses exact label IDs, forwards pagination, and deduplicates threads", async () => {
    token();
    fetchMock.mockResolvedValueOnce(
      Response.json({ labels: [{ id: "Label_1", name: "invoices" }] }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        messages: [{ threadId: "a" }, { threadId: "a" }, { threadId: "b" }],
        nextPageToken: "next",
      }),
    );
    const result = await new GmailClient(env as Env).listThreads("previous");
    expect(result).toEqual({ threadIds: ["a", "b"], nextPageToken: "next" });
    const request = fetchMock.mock.calls[2]?.[0];
    expect(String(request)).toContain("labelIds=Label_1");
    expect(String(request)).toContain("pageToken=previous");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reads nested MIME parts and scopes downloads to the loaded thread", async () => {
    token();
    fetchMock.mockResolvedValueOnce(Response.json({ messages: [message] }));
    fetchMock.mockResolvedValueOnce(Response.json({ data: pdf, size: 20 }));
    const gmail = new GmailClient(env as Env);
    const messages = await gmail.getThread("thread1");
    expect(messages[0]).toMatchObject({
      subject: "Invoice 123",
      body: "Pay USD 12.00",
      pdfAttachments: [{ id: "message1:2" }],
    });
    await expect(gmail.getPdf("another-message:2")).rejects.toThrow("from that thread");
    expect(await gmail.getPdf("message1:2")).toBe(pdf);
    expect(fetchMock).toHaveBeenCalledTimes(3); // One token refresh per client.
  });

  it("reads inline PDFs without a second Gmail request", async () => {
    token();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        messages: [{ ...message, payload: { mimeType: "application/pdf", body: { data: pdf } } }],
      }),
    );
    const gmail = new GmailClient(env as Env);
    await gmail.getThread("thread1");
    expect(await gmail.getPdf("message1:0")).toBe(pdf);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { body: { attachmentId: "attachment1", size: 11 * 1024 * 1024 }, error: "10 MiB" },
    { body: { data: btoa("not a pdf") }, error: "not a PDF" },
    { body: {}, error: "missing" },
  ])("rejects invalid or oversized PDFs: $error", async ({ body, error }) => {
    token();
    fetchMock.mockResolvedValueOnce(
      Response.json({ messages: [{ ...message, payload: { mimeType: "application/pdf", body } }] }),
    );
    const gmail = new GmailClient(env as Env);
    await gmail.getThread("thread1");
    await expect(gmail.getPdf("message1:0")).rejects.toThrow(error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not substitute a snippet or HTML for invoice text", async () => {
    token();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        messages: [
          {
            ...message,
            snippet: "Pay someone",
            payload: { mimeType: "text/html", body: { data: btoa("<p>Pay someone</p>") } },
          },
        ],
      }),
    );
    expect((await new GmailClient(env as Env).getThread("thread1"))[0]?.body).toBe("");
  });

  it("rejects a message from another thread", async () => {
    token();
    fetchMock.mockResolvedValueOnce(
      Response.json({ messages: [{ ...message, threadId: "other" }] }),
    );
    await expect(new GmailClient(env as Env).getThread("thread1")).rejects.toThrow(
      "another thread",
    );
  });

  it("rejects malformed API data", async () => {
    token();
    fetchMock.mockResolvedValueOnce(Response.json({ messages: [{ id: 42 }] }));
    await expect(new GmailClient(env as Env).getThread("thread1")).rejects.toThrow();
  });

  it("does not include a provider error body in exceptions", async () => {
    fetchMock.mockResolvedValueOnce(new Response("secret provider diagnostic", { status: 401 }));
    await expect(new GmailClient(env as Env).getThread("thread1")).rejects.toThrow(
      "Google token refresh failed (401)",
    );
  });
});
