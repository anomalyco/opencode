// The session list over the home (DLG16): opened with <leader>l, the first delete press marks the row, the
// second deletes the session. The masks keep the comparison to the dialog panel (x 6-93, y 8-18 at 100x30):
// the home and the footer around it are E.1's (T17-home-session-list, T04-connection-footer).
import { defineApp, session } from "../../lib/app"

const reason = "outside the dialog panel: the home behind it differs (T17-home-session-list, T04-connection-footer)"
// The panel's rows: 11 with two sessions, 10 once one is deleted.
const panel = (rows: number) => [
  { x: 0, y: 0, width: 100, height: 8, reason },
  { x: 0, y: 8 + rows, width: 100, height: 22 - rows, reason },
  { x: 0, y: 8, width: 6, height: rows, reason },
  { x: 94, y: 8, width: 6, height: rows, reason },
]
const masks = panel(11)

export default defineApp({
  routes: [
    {
      path: "/api/session",
      json: {
        data: [session("ses_b", "Fix the parser", { updated: 2 }), session("ses_a", "Write docs", { updated: 1 })],
        cursor: {},
      },
    },
    { method: "DELETE", path: "/api/session/ses_b" },
  ],
  steps: [
    { checkpoint: "home", until: "Ask anything", masks: [{ x: 0, y: 0, width: 100, height: 30, reason }] },
    { keys: ["ctrl+x", "l"] },
    { checkpoint: "list", until: "Write docs", masks },
    { keys: ["ctrl+d"] },
    { checkpoint: "marked", until: "again to confirm", masks },
    { keys: ["ctrl+d"] },
    { checkpoint: "deleted", until: "delete ctrl+d", masks: panel(10) },
  ],
})
