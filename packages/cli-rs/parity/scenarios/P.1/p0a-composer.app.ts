// A plugin's composer edit (rich plugins P0a, ABI 1.5): after typed text, F8 inserts text at the cursor, and typing
// goes on after it. TS's plugin inserts through `renderer.currentFocusedEditor`, as npm plugins do; Rust's twin
// through `edit_composer`. TS loads the plugin from parity/plugins/p0a as a local plugin; Rust registers its twin when
// OPENCODE_PARITY_PLUGIN is `p0a`.
import { defineApp } from "../../lib/app"

export default defineApp({
  config: { plugins: ["./plugins/p0a"] },
  env: { OPENCODE_PARITY_PLUGIN: "p0a" },
  steps: [
    { type: "hello " },
    { keys: ["f8"] },
    { type: "!" },
    { checkpoint: "inserted", until: "hello inserted!" },
  ],
})
