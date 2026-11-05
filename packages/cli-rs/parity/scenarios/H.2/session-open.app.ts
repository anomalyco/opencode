// `-s ses_b` opens the session, and a streamed text delta extends the assistant reply (T01, V01, V03).
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
    {
      event: {
        id: "evt_1",
        created: 3,
        type: "session.text.delta",
        durable: { aggregateID: "ses_b", seq: 1, version: 1 },
        data: { sessionID: "ses_b", assistantMessageID: "msg_2", ordinal: 0, delta: " Fixed." },
      },
    },
    {
      checkpoint: "streamed",
      until: "Fixed.",
      deviation: ["V01-plain-transcript"],
    },
  ],
})
