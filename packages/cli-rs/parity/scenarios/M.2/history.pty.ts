// Up at the start steps back through the session's prompts, Down at the end steps forward and restores the draft.
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
    { keys: "draft", settle: 200 },
    { keys: "\x1b[A", settle: 300, checkpoint: "start" },
    { keys: "\x1b[A", settle: 300, checkpoint: "third" },
    { keys: "\x1b[A", settle: 300, checkpoint: "second" },
    { keys: "\x1b[B", settle: 300 },
    { keys: "\x1b[B", settle: 300, checkpoint: "third-end" },
    { keys: "\x1b[B", settle: 300, checkpoint: "draft" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
