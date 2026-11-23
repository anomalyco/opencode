// `--session ses_b --fork` (T02): the session is forked, and the fork opens instead of the session.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_b", fork: true },
  routes: [
    {
      method: "POST",
      path: "/api/session/ses_b/fork",
      json: { data: session("ses_f", "Fix the parser (fork)", { updated: 3 }) },
    },
    { path: "/api/session/ses_f", json: { data: session("ses_f", "Fix the parser (fork)", { updated: 3 }) } },
    {
      path: "/api/session/ses_f/message",
      json: { data: [assistant("msg_2", "The parser drops the last token."), user("msg_1", "Why?")], cursor: {} },
    },
    { path: "/api/session/ses_f/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "forked",
      until: "The parser drops the last token.",
    },
  ],
})
