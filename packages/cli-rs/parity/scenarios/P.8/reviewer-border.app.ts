// CT-18: `mighty-reviewer@0.14.0`, unmodified from npm: its sidebar panel is a box with `border: { type: "single" }` and a
// border color. OpenTUI draws a border only for `true` or an array of sides, so TS draws the panel without one; the
// layer drew all four sides for any truthy `border`. TS loads the package from node_modules; the Rust client runs the
// same files on the JS host through the V2 compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_r"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/mighty-reviewer"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Review it", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Review it", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Reviewed.", 2000), user("msg_1", "Review it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [{ checkpoint: "sidebar", until: "Reviewed." }],
})
