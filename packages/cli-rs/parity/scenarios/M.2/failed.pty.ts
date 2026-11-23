// A turn that fails before its first step (`session.execution.failed` with no step error) prints the error once
// the session settles, above the turn summary; so does an interruption the user did not ask for.
import { definePty } from "../../pty/run"
import { config, event, leave, opened, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server({
    events: (id, requests) =>
      requests.filter((entry) => entry.path.endsWith("/prompt")).length === 1
        ? [
            event("session.inbox.delivered", { inboxID: id }),
            event("session.execution.started", {}),
            event("session.execution.failed", {
              error: { type: "provider", message: "API key is missing for provider demo" },
            }),
          ]
        : [
            event("session.inbox.delivered", { inboxID: id }),
            event("session.execution.started", {}),
            event("session.execution.interrupted", { reason: "shutdown" }),
          ],
  }),
  setup: (root) => config(root),
  steps: [
    opened,
    { keys: "hello", settle: 200 },
    { keys: "\r", until: { screen: "API key is missing" }, settle: 800, checkpoint: "failed" },
    { keys: "again", settle: 200 },
    { keys: "\r", until: { screen: "Session interrupted: shutdown" }, settle: 800, checkpoint: "interrupted" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
