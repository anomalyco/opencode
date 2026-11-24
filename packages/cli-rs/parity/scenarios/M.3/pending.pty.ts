// The pending-prompts panel (`session.queued_prompts`, Ctrl+X Q) while a turn runs: `queued_prompt.delete`
// (Ctrl+D) cancels the highlighted prompt, `queued_prompt.undo` (Ctrl+U) cancels it and puts it back in the
// composer, and Enter steers a queued one. Each write answers 204 and the server's inbox event follows.
import { definePty } from "../../pty/run"
import { event, leave, opened, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 30,
  server: server({
    wait: 30000,
    // The first prompt starts a turn that stays open while `session.wait` holds.
    events: (id, requests) =>
      requests.filter((entry) => entry.path.endsWith("/prompt")).length === 1
        ? [event("session.inbox.delivered", { inboxID: id }), event("session.execution.started", {})]
        : [],
  }),
  // A still spinner, so the screen settles while the turn runs.
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ animations: false, mini: { splash: "hide" } }),
    )
  },
  steps: [
    { ...opened, until: { screen: "ctrl+p menu" } },
    { keys: "first", settle: 200 },
    { keys: "\r", settle: 600 },
    { keys: "fix the tests", settle: 200 },
    { keys: "\x18\r", settle: 500 },
    { keys: "then the docs", settle: 200 },
    { keys: "\x18\r", until: { screen: "2 pending" }, settle: 500, checkpoint: "queued" },
    { keys: "\x18q", until: { screen: "Pending prompts" }, settle: 400, checkpoint: "panel" },
    { keys: "\x04", until: { screen: "Pending prompts 1" }, settle: 400, checkpoint: "deleted" },
    { keys: "\x15", until: { screen: "then the docs" }, settle: 600, checkpoint: "undone" },
    { keys: "\x18\r", until: { screen: "1 pending" }, settle: 500 },
    { keys: "\x18q", until: { screen: "Pending prompts" }, settle: 400 },
    { keys: "\r", settle: 800, checkpoint: "steered" },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
