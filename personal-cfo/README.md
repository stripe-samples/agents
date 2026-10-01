# Personal CFO

A read-only [Eve](https://eve.dev) agent that answers questions about your cash, spending, and connected accounts from your [Link](https://link.com) financial data.

It can list balances, transactions, and connected accounts. It cannot make purchases, retrieve payment credentials, or move money. Eve's shell, file, and web tools are disabled, so transaction text cannot direct the agent to run code or send your data elsewhere.

All sessions share the configured Link account. This sample is intended for personal, local use.

## Requirements

- Node.js 24
- pnpm 10
- [OpenRouter API key](https://openrouter.ai/settings/keys)
- A read-only Link access token (see below)

## Install

```bash
cd personal-cfo
pnpm install
cp .env.example .env.local
```

## Create a read-only Link token

Sign in with [Link CLI](https://docs.stripe.com/agentic-commerce/link-cli/oauth), requesting only financial-data access. Store the credentials outside this repository:

```bash
npx @stripe/link-cli --auth ~/.link-cli/personal-cfo.json auth login \
  --client-name "Personal CFO" \
  --scope "userinfo:read" \
  --source-actions read_link_transactions \
  --source-actions read_external_transactions \
  --source-actions read_balances \
  --source-actions read_source_details \
  --interval 5
```

Approve the request in the Link app, then copy the access token:

```bash
jq -r .auth.access_token ~/.link-cli/personal-cfo.json
```

Don't request `payment_methods.agentic`; this agent doesn't need it. Tokens expire, and this sample doesn't refresh them. When a token expires, sign in again and restart the server.

Add your credentials to `.env.local`:

```bash
OPENROUTER_API_KEY=your_key_here
LINK_ACCESS_TOKEN=your_token_here
```

## Run locally

```bash
pnpm run dev
```

Ask a question in the terminal UI, such as "How did I do last month?" or "What are my recurring charges?". The `monthly-review` skill handles monthly reviews and budget check-ins.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm check:tools
```

`pnpm check:tools` fails if the agent exposes any tool beyond the read-only allowlist, for example after a Link extension upgrade.

Run `pnpm format` to apply Biome formatting and safe lint fixes.
