// The vertical tab rail and its resize handle (W01, W04): two tabs in the rail at 120 columns, a drag of the
// handle from column 41 to 30 narrows the rail to 31, and a drag to column 8 makes it compact.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }
const messages = (text: string) => ({
  json: { data: [assistant("msg_2", text), user("msg_1", "Why?")], cursor: {} },
})

export default defineApp({
  width: 120,
  config: { experimental: { "new-designs": true }, tabs: { layout: "vertical" } },
  args: { sessionID: "ses_a" },
  routes: [
    { path: "/api/session/ses_a", json: { data: session("ses_a", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_a/message", ...messages("The parser drops the last token.") },
    { path: "/api/session/ses_a/inbox", json: { data: [] } },
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Write the release notes for the next version") } },
    { path: "/api/session/ses_b/message", ...messages("The notes are written.") },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { event: { id: "evt_1", created: 3, type: "tui.session.select", location: here, data: { sessionID: "ses_b" } } },
    { checkpoint: "rail", until: "The notes are written." },
    { drag: [[41, 10], [30, 10]] },
    { checkpoint: "resized", until: "The notes are written." },
    { drag: [[30, 10], [8, 10]] },
    { checkpoint: "compact", until: "The notes are written." },
  ],
})
