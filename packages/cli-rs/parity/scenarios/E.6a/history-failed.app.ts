// The session's first transcript read fails with a handler defect. TS's data layer drops the error, so the session
// opens with an empty transcript and no sign of the failure. Rust shows the same transcript and adds a toast with the
// error's message alone (O89-transcript-read-toast). The wait outlasts the read, so the toast is up at the checkpoint.
import { defineApp, session } from "../../lib/app"

export default defineApp({
  args: { sessionID: "ses_h" },
  routes: [
    { path: "/api/session/ses_h", json: { data: session("ses_h", "Fix the parser", { updated: 2 }) } },
    {
      path: "/api/session/ses_h/message",
      status: 500,
      json: {
        _tag: "UnknownError",
        message: "Server failed to handle the request. Check server logs for details.",
        ref: "err_1234abcd",
      },
    },
    { path: "/api/session/ses_h/inbox", json: { data: [] } },
  ],
  steps: [
    { wait: 500 },
    {
      checkpoint: "opened",
      until: "Fix the parser",
      // The toast's box, and nothing outside it.
      deviation: [{ file: "O89-transcript-read-toast", cells: 240 }],
    },
  ],
})
