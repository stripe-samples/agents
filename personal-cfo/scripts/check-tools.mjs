// Fails if Eve exposes any tool beyond the read-only allowlist, such as a new
// Link tool added by an extension upgrade.

import { deepStrictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";

const info = JSON.parse(
  execFileSync(process.execPath, ["node_modules/eve/bin/eve.js", "info", "--json"], {
    encoding: "utf8",
  }),
);

deepStrictEqual(info.status, "ready");
deepStrictEqual([...info.tools].sort(), [
  "link__list_balances",
  "link__list_sources",
  "link__list_transactions",
  "load_skill",
]);
console.log(`Tools: ${info.tools.join(", ")}`);
