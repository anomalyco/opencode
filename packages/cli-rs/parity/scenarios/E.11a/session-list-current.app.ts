// The session list opened from a session that is not the newest (DLG16): the selection starts on the first row, not
// on the current session (`focusCurrent={false}`).
import { assistant, defineApp, session, user } from "../../lib/app"

const placeholder = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder example: random in TS and Rust",
}

export default defineApp({
  routes: [
    {
      path: "/api/session",
      json: {
        data: [session("ses_b", "Fix the parser", { updated: 2 }), session("ses_a", "Write docs", { updated: 1 })],
        cursor: {},
      },
    },
    { path: "/api/session/ses_a", json: { data: session("ses_a", "Write docs", { updated: 1 }) } },
    {
      path: "/api/session/ses_a/message",
      json: {
        data: [assistant("msg_2", "The docs cover the parser."), user("msg_1", "Write the parser docs")],
        cursor: {},
      },
    },
    { path: "/api/session/ses_a/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "home", until: "Ask anything", masks: [placeholder] },
    { keys: ["ctrl+x", "l"] },
    { checkpoint: "list", until: "Write docs" },
    { keys: ["down"] },
    { keys: ["enter"] },
    { checkpoint: "session", until: "The docs cover the parser." },
    { keys: ["ctrl+x", "l"] },
    { checkpoint: "reopened", until: "Fix the parser" },
  ],
})
