// CT-31: `opencode-usage-report@0.6.4`, unmodified from npm. Its dialog's keys (`r`, `tab`, `j`) are a layer of
// `mode: "modal"`, a mode TS's keymap is in only while it says so, so they apply in no other. The layer kept every mode
// but `global` to the base mode, so the host took every `r` typed into the composer. Now such a layer's commands
// decline while the input mode is another, and the key goes on: the composer types `r` and a space, and Enter sends.
// TS loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer.
import { defineApp } from "../../lib/app"
import { keysApp } from "./keys"

export default defineApp({
  ...keysApp,
  config: { plugins: ["./out/npm/node_modules/opencode-usage-report"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
})
