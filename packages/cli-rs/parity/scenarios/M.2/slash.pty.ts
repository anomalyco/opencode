// `/` lists mini's built-ins and the server's commands; a query filters them; Escape removes the typed trigger;
// Enter on a command sends it with `session.command`; `/compact` cannot be queued.
import { definePty } from "../../pty/run"
import { config, leave, opened, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server(),
  setup: (root) => config(root),
  steps: [
    opened,
    { keys: "/", settle: 400, checkpoint: "slash" },
    { keys: "\x1b[B\x1b[B", settle: 300, checkpoint: "moved" },
    { keys: "re", settle: 400, checkpoint: "filtered" },
    { keys: "\x1b", settle: 300, checkpoint: "hidden" },
    { keys: "/rev", settle: 300 },
    { keys: "\r", settle: 800, checkpoint: "sent" },
    { keys: "/compact ", settle: 300 },
    { keys: "\x18\r", settle: 300, checkpoint: "not-queued" },
    // The first Ctrl+C clears the draft.
    { keys: "\x03", settle: 200 },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
