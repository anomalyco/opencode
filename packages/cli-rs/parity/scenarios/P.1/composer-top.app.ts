// The session.composer.top slot (P.1, E.13b): the test plugin's line shows under the queued dock and above the
// prompt, and stays above the composer when Down opens it and the dock hides. TS loads the plugin from
// parity/plugins/slot as a local plugin; Rust registers its twin when OPENCODE_PARITY_PLUGIN is `slot`.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_s"
// TS shows "Finishing startup…" for three seconds once loading the local TSX plugin took over half a second
// (`component/startup-loading.tsx`); Rust loads no TS plugin (F16).
const startup = { x: 39, y: 28, width: 22, height: 1, reason: "TS plugin loading notice (F16)" }

export default defineApp({
  height: 30,
  config: { experimental: { "new-designs": true }, plugins: ["./plugins/slot"] },
  env: { OPENCODE_PARITY_PLUGIN: "slot" },
  args: { sessionID: id },
  routes: [
    { path: `/api/session/${id}`, json: { data: session(id, "Plan the release", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Plan the release", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Done.", 2000), user("msg_1", "Ship it", 1000)], cursor: {} },
    },
    {
      path: `/api/session/${id}/inbox`,
      json: {
        data: [
          {
            id: "msg_5",
            sessionID: id,
            type: "user",
            payload: { text: "Then tag it" },
            delivery: "queue",
            time: { created: 3000 },
          },
        ],
      },
    },
  ],
  steps: [
    { checkpoint: "session", until: "Done.", masks: [startup] },
    { keys: ["down"] },
    { checkpoint: "composer", until: "Subagents", masks: [startup] },
  ],
})
