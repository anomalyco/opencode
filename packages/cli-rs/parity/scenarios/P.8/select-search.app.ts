// FT-12: a V2 plugin's `ui.dialog.select` with its own `search` (parity/plugins/v2search): the rows are the search's for each query, flat and in its order, so a query that only a description
// holds ("one") lists the rows the search keeps; Enter picks the first. TS loads the plugin as a local one; the Rust
// client runs the same file on the JS host through the V2 compatibility layer.
import { defineApp } from "../../lib/app"

export default defineApp({
  width: 120,
  height: 30,
  config: { experimental: { "new-designs": true }, plugins: ["./plugins/v2search"] },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  steps: [
    // Typed at once, so the plugin loads while the list is open, and its command joins the open list. The Rust client
    // remounts the route as a plugin loads, which closed the list (js-followups); TS keeps it open.
    { type: "/find" },
    { checkpoint: "slash", until: "Find a turn" },
    { keys: ["enter"] },
    { checkpoint: "listed", until: "red fish" },
    { type: "one" },
    {
      checkpoint: "searched",
      until: "someone else",
      // The list's dialog leaves the placeholder in view since #64983 dropped its empty footer row.
      masks: [{ x: 26, y: 16, width: 90, height: 1, reason: "the placeholder example: random in TS and Rust" }],
    },
    { keys: ["enter"] },
    {
      checkpoint: "picked",
      until: "picked t1",
      masks: [{ x: 26, y: 16, width: 90, height: 1, reason: "the placeholder example: random in TS and Rust" }],
    },
  ],
})
