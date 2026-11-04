// `--continue --prompt hello` (C01): the prompt goes to the continued session, not to a new one.
import { defineApp, session, user } from "../../lib/app"
import { catalog, inbox } from "./catalog"

export default defineApp({
  args: { continue: true, prompt: "hello" },
  routes: [
    ...catalog,
    { path: "/api/session", json: { data: [session("ses_b", "Fix the parser", { updated: 2 })], cursor: {} } },
    { path: "/api/session/ses_b", json: { data: session("ses_b", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_b/message", json: { data: [user("msg_1", "Why?")], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
    { method: "POST", path: "/api/session/ses_b/agent" },
    { method: "POST", path: "/api/session/ses_b/prompt", json: { data: inbox("ses_b") } },
    // TS opens a placeholder session route ("dummy") until the list answers; the Rust TUI stays on home.
    { path: "/api/session/dummy", json: { data: session("dummy", "") } },
    { path: "/api/session/dummy/message", json: { data: [], cursor: {} } },
    { path: "/api/session/dummy/inbox", json: { data: [] } },
  ],
  steps: [
    { checkpoint: "sent", until: "Fix the parser", deviation: ["P01-read-only-prompt", "C01-startup-prompt-cells"] },
  ],
})
