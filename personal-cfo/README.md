# Personal CFO

An [Eve](https://eve.dev) agent that reads your [Link](https://link.com) financial data and analyzes your cash, spending, and connected accounts.

It reads balances, transactions, and connected accounts, then summarizes spending by category, recurring charges, unusual items, and month-over-month changes. It analyzes by default and only creates or changes a spend request when you explicitly ask. Totals come from the `get_txn_summary` tool, which computes them in code instead of asking the model to do arithmetic. Eve's shell, file, and web tools are disabled, so transaction text cannot direct the agent to run code or send your data elsewhere.

All sessions share the configured Link account. This sample is intended for personal, local use.

## Requirements

- Node.js 24
- pnpm 10
- [OpenRouter API key](https://openrouter.ai/settings/keys)
- A Link access token (see below)

## Install

```bash
cd personal-cfo
pnpm install
cp .env.example .env.local
```

## Create a Link token

Sign in with [Link CLI](https://docs.stripe.com/agentic-commerce/link-cli/oauth), requesting financial-data access. Store the credentials outside this repository:

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

This token only reads data. To let the agent create spend requests when you ask, add `payment_methods.agentic` to `--scope`. Each spend request still needs your approval in Eve and in Link. Tokens expire, and this sample doesn't refresh them. When a token expires, sign in again and restart the server.

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
pnpm test
pnpm build
pnpm check:tools
```

`pnpm test` checks the aggregation in `agent/lib/txn-summary.ts`. `pnpm check:tools` fails if the agent exposes any tool other than the Link extension's, `load_skill`, and `get_txn_summary`, such as Eve's shell, file, or web tools.

Run `pnpm format` to apply Biome formatting and safe lint fixes.
