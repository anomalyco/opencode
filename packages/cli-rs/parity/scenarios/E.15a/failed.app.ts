// The diff viewer's narrow and failed states (F15): at 80 columns the panel cannot split, so `/diff` shows it full
// screen in the compact layout with its close footer; `diffs.source` "working" skips the base lookup, and a failed
// diff says so. `escape` closes it.
import { assistant, defineApp, session, user } from "../../lib/app"

export default defineApp({
  width: 80,
  height: 24,
  config: { experimental: { "new-designs": true }, diffs: { source: "working" } },
  args: { sessionID: "ses_f" },
  routes: [
    { path: "/api/session/ses_f", json: { data: session("ses_f", "Check the diff", { updated: 2 }) } },
    {
      path: "/api/session/ses_f/message",
      json: { data: [assistant("msg_2", "Nothing changed yet."), user("msg_1", "Any changes?")], cursor: {} },
    },
    { path: "/api/session/ses_f/inbox", json: { data: [] } },
    { path: "/api/vcs/diff", status: 500, json: { _tag: "UnknownError", message: "git failed" } },
  ],
  steps: [
    { checkpoint: "session", until: "Nothing changed yet." },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "failed", until: "Could not load diff" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Nothing changed yet." },
  ],
})
