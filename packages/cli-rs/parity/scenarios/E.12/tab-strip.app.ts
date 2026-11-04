// The horizontal tab strip (W01, W02, W08): a session opens as a tab, a second joins it, `<leader>1` selects the
// first and leaves the unread second one glowing, `<leader>w` closes a tab and goes back in the history (which
// acknowledges the unread session, `session.view`), `ctrl+shift+t` reopens it, and `<leader>n` shows the
// new-session tab on home.
import { assistant, defineApp, session, user } from "../../lib/app"

const here = { directory: "/tmp/opencode/packages/tui" }
const select = (id: string, sessionID: string) => ({
  event: { id, created: 3, type: "tui.session.select", location: here, data: { sessionID } },
})
const messages = (text: string) => ({
  json: { data: [assistant("msg_2", text), user("msg_1", "Why?")], cursor: {} },
})
// The home prompt draws no placeholder (T17).
const home = [
  { x: 16, y: 17, width: 72, height: 1, reason: "the home placeholder: random in TS, not drawn in Rust (T17-home-prompt)" },
]
// Read by the prompt as soon as the session is the open one: idle at 5, never viewed.
const unread = { ...session("ses_b", "Write the docs", { updated: 2 }), time: { created: 2, updated: 5, idle: 5 } }

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_a" },
  routes: [
    { path: "/api/session/ses_a", json: { data: session("ses_a", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_a/message", ...messages("The parser drops the last token.") },
    { path: "/api/session/ses_a/inbox", json: { data: [] } },
    { path: "/api/session/ses_b", json: { data: unread } },
    { path: "/api/session/ses_b/message", ...messages("The docs are written.") },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    { method: "POST", path: "/api/session/:sessionID/view" },
  ],
  steps: [
    { checkpoint: "one", until: "The parser drops the last token." },
    select("evt_1", "ses_b"),
    { checkpoint: "two", until: "The docs are written." },
    { keys: ["ctrl+x", "1"] },
    { checkpoint: "unread", until: "The parser drops the last token." },
    { keys: ["ctrl+x", "w"] },
    { checkpoint: "closed", until: "The docs are written." },
    { keys: ["ctrl+shift+t"] },
    { checkpoint: "reopened", until: "The parser drops the last token." },
    { keys: ["ctrl+x", "n"] },
    { checkpoint: "new", until: "New session", masks: home },
  ],
})
