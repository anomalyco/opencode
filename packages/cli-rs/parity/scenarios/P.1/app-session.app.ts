// The app slot (P.1) in a session: the test plugin's line shows under the session route, below the prompt. TS
// loads the plugin from parity/plugins/app as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN
// is `app`.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_a"

export default defineApp({
  config: { plugins: ["./plugins/app"] },
  env: { OPENCODE_PARITY_PLUGIN: "app" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Plan the release", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Plan the release", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Done.", 2000), user("msg_1", "Ship it", 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [{ checkpoint: "session", until: "Done." }],
})
