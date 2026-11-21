// P8: `opencode-subagents-sidebar@0.1.6`, unmodified from npm, in the session sidebar: the session's two subagent
// sessions under a "Subagents" header, newest first, the running one's dot green. TS loads the package from
// node_modules; the Rust client runs the same files on the JS host through the V2 compatibility layer.
import { defineApp, session, user } from "../../lib/app"

const parent = { ...session("ses_s", "Plan the release", { updated: 5 }) }
const child = (id: string, title: string, updated: number) => ({ ...session(id, title, { updated }), parentID: "ses_s" })

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-subagents-sidebar"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: "ses_s" },
  routes: [
    { path: "/api/session/ses_s", json: { data: parent } },
    {
      path: "/api/session",
      json: {
        data: [parent, child("ses_c1", "Write the changelog", 4), child("ses_c2", "Tag the release", 3)],
        cursor: {},
      },
    },
    { path: "/api/session/ses_s/message", json: { data: [user("msg_1", "Plan it")], cursor: {} } },
    { path: "/api/session/ses_s/inbox", json: { data: [] } },
  ],
  steps: [{ checkpoint: "listed", until: "Subagents" }],
})
