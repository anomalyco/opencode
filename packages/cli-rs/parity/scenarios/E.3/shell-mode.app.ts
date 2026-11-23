// Prompt shell mode (#63605): `!` turns the prompt into shell mode, whose border and "Shell" label take the second
// categorical color under the new designs instead of the interactive color the first agent shares.
import { defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_b" },
  routes: [
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why does the parser fail?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "open", until: "Why does the parser fail?" },
    { type: "!" },
    { checkpoint: "shell", until: "exit shell mode" },
  ],
})
