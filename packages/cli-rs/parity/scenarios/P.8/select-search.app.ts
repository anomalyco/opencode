// FT-12: a V2 plugin's `ui.dialog.select` with its own `search` (parity/plugins/v2search, as opencode-session-time's
// `/time`): the rows are the search's for each query, flat and in its order, so a query that only a description
// holds ("one") lists the rows the search keeps; Enter picks the first. TS loads the plugin as a local one; the Rust
// client runs the same file on the JS host through the V2 compatibility layer.
import { defineApp } from "../../lib/app"

export default defineApp({
  width: 120,
  height: 30,
  config: { experimental: { "new-designs": true }, plugins: ["./plugins/v2search"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  steps: [
    // The plugin loaded before `/` is typed (its footer line): a plugin that loads while the list is open remounts the
    // route in Rust, which closes the list (reported with FT-12).
    {
      checkpoint: "home",
      until: "v2search loaded",
      masks: [{ x: 26, y: 16, width: 90, height: 1, reason: "the placeholder example: random in TS and Rust" }],
    },
    { type: "/find" },
    { checkpoint: "slash", until: "Find a turn" },
    { keys: ["enter"] },
    { checkpoint: "listed", until: "red fish" },
    { type: "one" },
    { checkpoint: "searched", until: "someone else" },
    { keys: ["enter"] },
    {
      checkpoint: "picked",
      until: "picked t1",
      masks: [{ x: 26, y: 16, width: 90, height: 1, reason: "the placeholder example: random in TS and Rust" }],
    },
  ],
})
