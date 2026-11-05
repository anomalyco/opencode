// The session prompt (P01, P15): its border and metadata row, then a two-line prompt typed through the
// input.* layer (Shift+Enter inserts the newline).
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_b" },
  routes: [
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
      checkpoint: "open",
      until: "The parser drops the last token.",
    },
    { type: "hello wrld" },
    { keys: ["left", "left", "left"] },
    { type: "o" },
    { keys: ["ctrl+e", "shift+enter"] },
    { type: "second line" },
    {
      checkpoint: "typed",
      until: "second line",
    },
  ],
})
