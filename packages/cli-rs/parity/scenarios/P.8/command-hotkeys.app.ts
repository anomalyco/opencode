// Ports trio: `opencode-command-hotkeys@0.1.1`, unmodified from npm, with two bindings in its options: alt+r runs the
// server's `review` command with `--all` in the session in view, and the palette's "Run the review" runs it again.
// TS loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer, and its native and Luau ports in its place (`app::ports_replay`).
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_h"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: [
      {
        package: "./out/npm/node_modules/opencode-command-hotkeys",
        options: {
          bindings: [
            { id: "review", key: "alt+r", title: "Run the review", command: "review", text: "--all" },
            { id: "goal", key: "alt+o", title: "Toggle the goal", action: "goal-toggle" },
          ],
        },
      },
    ],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Review it", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Review it", { updated: 2 })], cursor: {} } },
    { path: `/api/session/${id}/message`, json: { data: [assistant("msg_2", "Ready.", 2000), user("msg_1", "Review it", 1000)], cursor: {} } },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: `/api/session/${id}/command`, status: 204 },
  ],
  steps: [
    { checkpoint: "ready", until: "Review it" },
    { keys: ["alt+r"] },
    { wait: 300 },
    { keys: ["ctrl+p"] },
    // The palette's own list is not the plugin's to compare; its search is.
    { wait: 500 },
    { type: "Run the review" },
    { checkpoint: "found", until: "Run the review" },
    { keys: ["enter"] },
    { wait: 300 },
    { checkpoint: "ran" },
  ],
})
