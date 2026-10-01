// Fails if Eve exposes a tool other than the Link extension's, load_skill, and
// get_txn_summary, such as shell, file, or web tools. Transaction text is untrusted, so those would let it run code
// or send financial data elsewhere.
import { deepStrictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";

const info = JSON.parse(
  execFileSync(process.execPath, ["node_modules/eve/bin/eve.js", "info", "--json"], {
    encoding: "utf8",
  }),
);

deepStrictEqual(info.status, "ready");
deepStrictEqual(
  info.tools.filter(
    (name) => !["load_skill", "get_txn_summary"].includes(name) && !name.startsWith("link__"),
  ),
  [],
);
console.log(`Tools: ${info.tools.join(", ")}`);
