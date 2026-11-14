// `@` lists subagents, then the file search's results; Tab picks one as a mention part, and Enter sends it in the
// prompt's `agents` and `files`.
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
    { keys: "ask @gen", settle: 600, checkpoint: "listed" },
    { keys: "\t", settle: 300, checkpoint: "agent" },
    { keys: "and @main", settle: 600, checkpoint: "file" },
    { keys: "\r", settle: 300, checkpoint: "picked" },
    { keys: "\x7f\x7f", settle: 300, checkpoint: "atomic" },
    { keys: "@main", settle: 600 },
    { keys: "\r", settle: 300 },
    { keys: "\r", settle: 1000, checkpoint: "sent" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
