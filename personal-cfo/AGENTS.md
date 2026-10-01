# Eve Agent App

This project uses the Eve framework. Before writing code, read the relevant guide
from the installed Eve package docs at `node_modules/eve/docs/`. If those docs are
unavailable, use https://eve.dev/docs as a fallback.

The Link integration is mounted in `agent/extensions/link.ts`. Its tools and skills
come from `@stripe/link-integrations-eve`; read that package's README before changing
the mount or authorization. Preserve its default purchase approval policy.

`agent/agent.ts` disables Eve's default tools because transaction text is untrusted.
Do not add shell, file, or web tools. `pnpm check:tools` fails if any tool other
than the Link extension's, `load_skill`, and `get_txn_summary` is exposed.

`agent/tools/get_txn_summary.ts` does the agent's arithmetic so the model never
totals amounts itself. Its logic lives in `agent/lib/txn-summary.ts`, tested by
`pnpm test`. It follows the planned Link `get_txn_summary` shape; replace it with
Link's tool once that ships.

Keep Eve at `0.54.4` until a compatible Link extension is published. Link `0.2.0`
requires tool contract v36, which Eve `0.68.0` does not support.
