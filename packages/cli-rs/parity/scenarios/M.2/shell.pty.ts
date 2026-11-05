// `!` at the start enters shell mode, Escape leaves it, Backspace at the start leaves it; Enter runs the command
// with `session.shell` and the composer returns to normal mode.
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
    { keys: "!", settle: 300, checkpoint: "shell" },
    { keys: "\x1b", settle: 300, checkpoint: "normal" },
    { keys: "!", settle: 200 },
    { keys: "\x7f", settle: 300, checkpoint: "backspace" },
    { keys: "!ls -la", settle: 300, checkpoint: "typed" },
    { keys: "\r", settle: 800, checkpoint: "ran" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
