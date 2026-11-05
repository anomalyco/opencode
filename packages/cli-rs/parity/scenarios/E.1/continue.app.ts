// `--continue` (T02): the newest root session of the default location opens.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  args: { continue: true },
  routes: [
    { path: "/api/session", json: { data: [session("ses_b", "Fix the parser", { updated: 2 })], cursor: {} } },
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_b/message",
      json: { data: [assistant("msg_2", "The parser drops the last token."), user("msg_1", "Why?")], cursor: {} },
    },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    // TS opens a placeholder session route ("dummy") until the list answers; the Rust TUI stays on home.
    { path: "/api/session/dummy", json: { data: session("dummy", "") } },
    { path: "/api/session/dummy/message", json: { data: [], cursor: {} } },
    { path: "/api/session/dummy/inbox", json: { data: [] } },
  ],
  steps: [
    {
      checkpoint: "continued",
      until: "The parser drops the last token.",
    },
  ],
})
