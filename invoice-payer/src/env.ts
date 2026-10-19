import { z } from "zod";

const credentials = z.object({
  STRIPE_API_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  RUN_AUTH_TOKEN: z.string().min(32),
});

export type Env = CloudflareBindings & z.infer<typeof credentials>;

export function validateCredentials(env: Env): void {
  const result = credentials.safeParse(env);
  if (!result.success) {
    // Report field names only; never include secret values or provider responses.
    throw new Error(
      `Configure Worker secrets: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
}

export const threadIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const queueMessageSchema = z.object({ threadId: threadIdSchema });

export type ThreadMessage = z.infer<typeof queueMessageSchema>;
