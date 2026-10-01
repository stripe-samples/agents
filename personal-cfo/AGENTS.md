# Eve Agent App

This project uses the Eve framework. Before writing code, read the relevant guide
from the installed Eve package docs at `node_modules/eve/docs/`. If those docs are
unavailable, use https://eve.dev/docs as a fallback.

The Link integration is mounted in `agent/extensions/link/extension.ts`. Its tools
and skills come from `@stripe/link-integrations-eve`; read that package's README
before changing the mount or authorization.

This agent is read-only. `agent/agent.ts` disables Eve's default tools, and
`agent/extensions/link/tools/` disables every Link tool except `list_transactions`,
`list_balances`, and `list_sources`. `pnpm check:tools` fails if any other tool is
exposed; update its allowlist only for read-only tools.
Do not add shell, file, or web tools: transaction text is untrusted.

Keep Eve at `0.54.4` until a compatible Link extension is published. Link `0.2.0`
requires tool contract v36, which Eve `0.68.0` does not support.
