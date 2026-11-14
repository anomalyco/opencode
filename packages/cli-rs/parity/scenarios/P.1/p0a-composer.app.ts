// A plugin's composer edits (rich plugins P0a, ABI 1.5): F8 inserts text at the cursor, in the middle of typed text,
// and typing goes on after it; F9 sets the text and puts the cursor at its end. TS's plugin inserts through `renderer.currentFocusedEditor`, as npm plugins do; Rust's twin
// through `edit_composer`. TS loads the plugin from parity/plugins/p0a as a local plugin; Rust registers its twin when
// OPENCODE_PARITY_PLUGIN is `p0a`.
import { defineApp } from "../../lib/app"

// TS shows "Finishing startup…" for three seconds once loading the local TSX plugin took over half a second
// (`component/startup-loading.tsx`); Rust loads no TS plugin (F16).
const startup = { x: 39, y: 28, width: 22, height: 1, reason: "TS plugin loading notice (F16)" }

export default defineApp({
  config: { plugins: ["./plugins/p0a"] },
  env: { OPENCODE_PARITY_PLUGIN: "p0a" },
  steps: [
    { type: "hello world" },
    { keys: ["left", "left", "left", "left", "left"] },
    { keys: ["f8"] },
    { type: "!" },
    { checkpoint: "inserted", until: "hello inserted!world", masks: [startup] },
    { keys: ["f9"] },
    { type: "?" },
    { checkpoint: "set", until: "set by the plugin?", masks: [startup] },
  ],
})
