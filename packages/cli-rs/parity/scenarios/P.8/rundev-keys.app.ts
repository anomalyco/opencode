// CT-19: `opencode-rundev@0.1.5`, unmodified from npm. A global layer of its binds `up`, `down`, `space`, `return` and
// `escape` for its service picker, and each returns `false` while the picker is closed, which in TS lets the key fall
// through. The host took the key anyway, so space typed nothing and Enter never sent the prompt. Now a declined key
// goes on to the host: the composer types the space, and Enter sends. TS loads the package from node_modules; the Rust
// client runs the same files on the JS host through the V2 compatibility layer.
import { defineApp } from "../../lib/app"
import { keysApp } from "./keys"

export default defineApp({
  ...keysApp,
  config: { plugins: ["./out/npm/node_modules/opencode-rundev"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
})
