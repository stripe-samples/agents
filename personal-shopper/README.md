# Personal Shopper

An [Eve](https://eve.dev) agent that browses with [Kernel](https://www.kernel.sh), uses your Link wallet for approved purchases, and answers questions about your connected financial data.

All sessions share the configured Link wallet and Kernel account. This sample is intended for personal, local use.

## Requirements

- Node.js 24
- pnpm 10
- [OpenRouter API key](https://openrouter.ai/settings/keys)
- [Kernel API key](https://dashboard.onkernel.com/api-keys)
- [Link wallet access token](https://docs.stripe.com/agentic-commerce/link-cli/oauth)

## Install

```bash
cd personal-shopper
pnpm install
cp .env.example .env.local
```

Add your credentials to `.env.local`:

```bash
OPENROUTER_API_KEY=your_key_here
KERNEL_API_KEY=your_key_here
LINK_ACCESS_TOKEN=your_token_here
```

## Run locally

```bash
pnpm run dev
```

Enter a shopping request or wallet question in the terminal UI. For purchases, follow the Link approval URL, then confirm the final order before checkout.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Run `pnpm format` to apply Biome formatting and safe lint fixes.
