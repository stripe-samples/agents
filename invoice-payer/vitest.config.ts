import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          RUN_AUTH_TOKEN: "test-only-token-with-at-least-32-characters",
          STRIPE_API_KEY: "test-only-stripe-key",
          OPENROUTER_API_KEY: "test-only-openrouter-key",
          GOOGLE_CLIENT_ID: "test-only-client-id",
          GOOGLE_CLIENT_SECRET: "test-only-client-secret",
          GOOGLE_REFRESH_TOKEN: "test-only-refresh-token",
        },
      },
    }),
  ],
});
