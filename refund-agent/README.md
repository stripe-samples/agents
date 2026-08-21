# Refund Agent

An [eve](https://eve.dev) agent that finds Stripe payments, checks refund requests against policy, and asks for human approval before creating a refund.

## Requirements

- Node.js 24
- pnpm 10
- An API key to an LLM provider
- Access to the Stripe account you want to use

## Install

```bash
cd refund-agent
pnpm install
```

Add your OpenRouter key to `.env`:

```bash
OPENROUTER_API_KEY=your_key_here
```

## Run locally

```bash
pnpm run dev
```

Enter a refund request in the terminal UI. The first Stripe action may show an authorization URL.

Press `Ctrl+C` to stop the server.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Run `pnpm format` to apply Biome formatting and safe lint fixes.
