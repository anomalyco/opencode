// The sidebar below 120 columns (V19): hidden by default, `<leader>b` shows it over the dimmed session on the
// right, and Escape closes it.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_o" },
  routes: [
    { path: "/api/session/ses_o", json: { data: session("ses_o", "Narrow sidebar", { updated: 2 }) } },
    {
      path: "/api/session/ses_o/message",
      json: { data: [assistant("msg_2", "Shown over the session."), user("msg_1", "Where is it?")], cursor: {} },
    },
    { path: "/api/session/ses_o/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "closed", until: "Shown over the session." },
    { keys: ["ctrl+x", "b"] },
    { checkpoint: "overlay", until: "Narrow sidebar" },
    { keys: ["escape"] },
    { checkpoint: "escaped" },
  ],
})
