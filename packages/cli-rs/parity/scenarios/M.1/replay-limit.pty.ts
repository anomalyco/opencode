// `mini -s ses_mini --replay-limit 2`: only the newest two messages are listed and replayed, below the header.
import { definePty } from "../../pty/run"
import { config, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini", "--replay-limit", "2"],
  cols: 60,
  rows: 16,
  server: server(),
  setup: (root) => config(root),
  steps: [
    { until: { screen: "Third answer" }, settle: 600, timeout: 30_000, checkpoint: "replayed", scrollback: 8 },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
