// Pastes (P06): a three-line paste collapses into a `[Pasted ~3 lines]` part in the `extmark.paste` style, the
// same text pasted again right after it expands in place, and a short paste goes in as it is, ANSI stripped.
import { defineApp, session, user } from "../../lib/app"

const pasted = "first line\nsecond line\nthird line"

export default defineApp({
  args: { sessionID: "ses_b" },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why does the parser fail?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "Why does the parser fail?" },
    { type: "see " },
    { paste: pasted },
    { checkpoint: "compact", until: "[Pasted ~3 lines]" },
    { paste: pasted },
    { checkpoint: "expanded", until: "third line" },
    { keys: ["ctrl+c"] },
    { paste: "short \u001b[31mred\u001b[0m paste" },
    { checkpoint: "short", until: "short red paste" },
  ],
})
