// Home with two sessions, the session list, and opening the newest session from it (T01, DLG14).
import { assistant, defineApp, session, user } from "../../lib/app"

// To the end of the row: the placeholders differ in length.
const placeholder = { line: "Ask anything….*", reason: "the prompt placeholder is picked at random" }

export default defineApp({
  routes: [
    {
      path: "/api/session",
      json: {
        data: [session("ses_b", "Fix the parser", { updated: 2 }), session("ses_a", "Write docs", { updated: 1 })],
        cursor: {},
      },
    },
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_b/message",
      json: {
        data: [assistant("msg_2", "The parser drops the last token."), user("msg_1", "Why does the parser fail?")],
        cursor: {},
      },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [placeholder],
      deviation: ["T17-home-prompt"],
    },
    { keys: ["ctrl+x", "l"] },
    {
      checkpoint: "list",
      until: "Write docs",
    },
    { keys: ["enter"] },
    {
      checkpoint: "session",
      until: "The parser drops the last token.",
    },
  ],
})
