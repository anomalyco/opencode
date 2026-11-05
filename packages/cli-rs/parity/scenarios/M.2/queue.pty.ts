// While a turn runs, Enter steers the next prompt into the inbox and `prompt.queue` (Ctrl+X Enter) queues one;
// a shell command cannot be queued; Ctrl+L clears the screen.
import { definePty } from "../../pty/run"
import { event, leave, opened, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server({
    wait: 6000,
    // The first prompt starts a turn that stays open while `session.wait` holds.
    events: (id, requests) =>
      requests.filter((entry) => entry.path.endsWith("/prompt")).length === 1
        ? [event("session.inbox.delivered", { inboxID: id }), event("session.execution.started", {})]
        : [],
  }),
  // A still spinner, so the screen settles while the turn runs.
  setup: (root) =>
    Bun.write(`${root}/home/.config/opencode/cli.json`, JSON.stringify({ animations: false, mini: { splash: "hide" } })),
  steps: [
    opened,
    { keys: "first", settle: 200 },
    { keys: "\r", settle: 600, checkpoint: "running" },
    { keys: "steer this", settle: 200 },
    { keys: "\r", settle: 600 },
    { keys: "queue this", settle: 200 },
    { keys: "\x18\r", settle: 600, checkpoint: "queued" },
    { keys: "!", settle: 100 },
    { keys: "ls", settle: 100 },
    { keys: "\x18\r", settle: 400, checkpoint: "refused" },
    { keys: "\x1b", settle: 100 },
    { keys: "\x0c", settle: 600, checkpoint: "cleared" },
    // The first Ctrl+C clears the draft.
    { keys: "\x03", settle: 200 },
    ...leave,
  ],
  exits: true,
  masks: [
    statusMask,
    {
      pattern: /^▪ esc (interrupt|stop) · (ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
      reason: "the pending and menu hints open M.3's views; without them the wider interrupt hint fits",
    },
  ],
  requests: "writes",
})
