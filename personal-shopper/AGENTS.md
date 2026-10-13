# Eve Agent App

This project uses the Eve framework. Before writing code, read the relevant guide
from the installed Eve package docs at `node_modules/eve/docs/`. If those docs are
unavailable, use https://eve.dev/docs as a fallback.

The Link integration is mounted in `agent/extensions/link.ts`. Its tools and skills
come from `@stripe/link-integrations-eve`; read that package's README before changing
the mount or authorization. Preserve its default purchase approval policy.

Keep Eve and the Link extension compatible. Link `0.3.2` is built with Eve
`0.71.2` and requires tool contract v73. Check the extension's generated
compatibility metadata and build the sample when upgrading either package.
