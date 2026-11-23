// A command the server fails with a handler defect (#64022): `session.command` declares the 500, whose body is the
// protocol's `UnknownError`, a message and a log ref. The toast shows the message alone, without the tag or the ref.
import { defineApp, session, user } from "../../lib/app"
import { catalog } from "./catalog"

const location = { directory: "/tmp/opencode/packages/tui" }

export default defineApp({
  args: { sessionID: "ses_d" },
  routes: [
    ...catalog,
    { path: "/api/command", json: { location, data: [{ name: "review", description: "Review the working tree" }] } },
    { path: "/api/session/ses_d", json: { data: session("ses_d", "Fix the parser", { updated: 2 }) } },
    { path: "/api/session/ses_d/message", json: { data: [user("msg_1", "Why?")], cursor: {} } },
    { path: "/api/session/ses_d/inbox", json: { data: [] } },
    { method: "POST", path: "/api/session/ses_d/agent" },
    {
      method: "POST",
      path: "/api/session/ses_d/command",
      status: 500,
      json: {
        _tag: "UnknownError",
        message: "Server failed to handle the request. Check server logs for details.",
        ref: "err_1234abcd",
      },
    },
  ],
  steps: [
    { checkpoint: "session", until: "Demo Model" },
    { type: "/review now" },
    { keys: ["enter"] },
    { checkpoint: "failed", until: "Check server logs" },
  ],
})
