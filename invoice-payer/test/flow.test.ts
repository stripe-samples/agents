import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Env } from "../src/env";
import { GmailClient } from "../src/gmail";
import { Inbox } from "../src/inbox";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await reset();
});

it("uses discovered MCP tools directly through PDF reading, payment, and approval justification", async () => {
  vi.spyOn(GmailClient.prototype, "getThread").mockResolvedValue([
    {
      id: "message1",
      from: "vendor@example.com",
      subject: "Invoice 123",
      receivedAt: "2026-10-19T00:00:00Z",
      body: "See PDF",
      pdfAttachments: [{ id: "message1:1", filename: "invoice.pdf", size: 20 }],
    },
  ]);
  vi.spyOn(GmailClient.prototype, "getPdf").mockResolvedValue(btoa("%PDF-1.7\nexample"));
  const approvalMessage =
    'Human approval required.\n**Approval Request**: apr_123\n**Approval URL**: https://dashboard.stripe.com/example\nAdd a reason using stripe_api_write with stripe_api_operation_id "PostV2CoreApprovalRequestsId" and parameters { id, reason }.';
  const send = vi.fn(async () => {
    throw new Error(approvalMessage);
  });
  const write = vi.fn(async () => ({ content: [{ type: "text", text: "Justification saved" }] }));
  const agent = await getAgentByName(env.InvoicePayer, "thread1");
  await runInDurableObject(agent, (instance) => {
    vi.spyOn(instance, "addMcpServer").mockResolvedValue({ id: "stripe", state: "ready" });
    vi.spyOn(instance.mcp, "waitForConnections").mockResolvedValue();
    vi.spyOn(instance.mcp, "getAITools").mockReturnValue({
      tool_stripe_send_money: { inputSchema: z.object({ amount: z.number() }), execute: send },
      tool_stripe_stripe_api_read: { inputSchema: z.object({}), execute: async () => ({}) },
      tool_stripe_stripe_api_write: {
        inputSchema: z.object({
          stripe_api_operation_id: z.string(),
          parameters: z.record(z.string(), z.unknown()),
        }),
        execute: write,
      },
      tool_stripe_setup_recipient: { inputSchema: z.object({}), execute: async () => ({}) },
      tool_stripe_convert_currency: { inputSchema: z.object({}), execute: async () => ({}) },
    });
    vi.spyOn(instance, "removeMcpServer").mockResolvedValue();
  });

  const responses = [
    { type: "tool_use", id: "call1", name: "get_thread", input: {} },
    { type: "tool_use", id: "call2", name: "get_pdf", input: { id: "message1:1" } },
    { type: "tool_use", id: "call3", name: "tool_stripe_send_money", input: { amount: 1200 } },
    {
      type: "tool_use",
      id: "call4",
      name: "tool_stripe_stripe_api_write",
      input: {
        stripe_api_operation_id: "PostV2CoreApprovalRequestsId",
        parameters: {
          id: "apr_123",
          reason: "Invoice 123 from invoice.pdf: USD 12.00 to the existing vendor.",
        },
      },
    },
    { type: "text", text: "Invoice 123: USD 12.00 is awaiting approval (apr_123)." },
  ];
  const requests: unknown[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-only-openrouter-key");
    const request: unknown = JSON.parse(String(init?.body));
    requests.push(request);
    expect(request).toMatchObject({
      model: "anthropic/claude-sonnet-5",
      plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
    });
    const content = responses.shift();
    if (!content) throw new Error("Unexpected extra model call");
    return Response.json({
      id: `gen_${responses.length}`,
      object: "chat.completion",
      created: 1792411200,
      model: "anthropic/claude-sonnet-5",
      choices: [
        {
          index: 0,
          message:
            content.type === "tool_use"
              ? {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: content.id,
                      type: "function",
                      function: { name: content.name, arguments: JSON.stringify(content.input) },
                    },
                  ],
                }
              : { role: "assistant", content: content.text },
          finish_reason: content.type === "tool_use" ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await agent.processThread();
  expect(result.status).toBe("completed");
  expect(result.summary).toContain("awaiting approval");
  expect(result.toolsUsed).toEqual([
    "get_thread",
    "get_pdf",
    "tool_stripe_send_money",
    "tool_stripe_stripe_api_write",
  ]);
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({
      stripe_api_operation_id: "PostV2CoreApprovalRequestsId",
      parameters: expect.objectContaining({ id: "apr_123" }),
    }),
    expect.anything(),
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(5);
  const { tools: offeredTools } = z
    .object({
      tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
    })
    .parse(requests[0]);
  expect(offeredTools.map((t) => t.function.name)).toEqual([
    "tool_stripe_send_money",
    "tool_stripe_stripe_api_read",
    "tool_stripe_stripe_api_write",
    "tool_stripe_setup_recipient",
    "tool_stripe_convert_currency",
    "get_thread",
    "get_pdf",
  ]);
  expect(requests[3]).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        tool_call_id: "call3",
        content: expect.stringContaining(approvalMessage),
      }),
    ]),
  });
  expect(requests[2]).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "file",
            file: expect.objectContaining({
              file_data: `data:application/pdf;base64,${btoa("%PDF-1.7\nexample")}`,
            }),
          }),
        ]),
      }),
    ]),
  });
  await agent.processThread();
  expect(send).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("keeps an outbox entry after enqueue fails and continues Gmail pagination", async () => {
  const list = vi
    .spyOn(GmailClient.prototype, "listThreads")
    .mockResolvedValueOnce({ threadIds: ["thread1", "thread1"], nextPageToken: "page2" })
    .mockResolvedValueOnce({ threadIds: ["thread2"] });
  const sendBatch = vi
    .fn()
    .mockRejectedValueOnce(new Error("Queue unavailable"))
    .mockResolvedValue(undefined);
  const stub = env.Inbox.get(env.Inbox.idFromName("default"));
  await runInDurableObject(stub, async (_instance, state) => {
    const subject = new Inbox(state, {
      ...(env as Env),
      INVOICE_QUEUE: { ...env.INVOICE_QUEUE, sendBatch },
    });
    await expect(subject.poll()).rejects.toThrow("Queue unavailable");
    expect(subject.listThreads()).toMatchObject([{ thread_id: "thread1", status: "queued" }]);
    expect(await subject.poll()).toEqual(["thread1", "thread2"]);
    expect(list).toHaveBeenNthCalledWith(2, "page2");
    expect(sendBatch).toHaveBeenLastCalledWith([
      { body: { threadId: "thread1" } },
      { body: { threadId: "thread2" } },
    ]);
    subject.recordStatus("thread1", "completed");
    expect(subject.hasThread("thread1")).toBe(true);
  });
});
