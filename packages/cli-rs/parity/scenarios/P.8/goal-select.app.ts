// CT-14: `@cleocode/goal@0.13.0`, unmodified from npm: its sidebar section is a one-row OpenTUI `<select>` that opens
// its goals manager. The layer had no `<select>`, so the slot crashed and the section was missing. Now a select draws
// as OpenTUI's renderable draws it: a row of each option that fits, the selected one with `▶ ` on its background. TS
// loads the package from node_modules; the Rust client runs the same files on the JS host through the V2
// compatibility layer.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_o"

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/@cleocode/goal"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Set a goal", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Set a goal", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Goal set.", 2000), user("msg_1", "Set it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
    { method: "POST", path: "/api/rpc/open-goal/:method", status: 404, json: { _tag: "NotFound", message: "no such RPC" } },
  ],
  // Its goals load from its server part, which is not running here: the select offers to retry, in both clients.
  steps: [{ checkpoint: "sidebar", until: "F9 manager" }],
})
