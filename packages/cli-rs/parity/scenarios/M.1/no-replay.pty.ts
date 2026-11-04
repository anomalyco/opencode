// `mini -s ses_mini --no-replay`: the terminal is still cleared for the resumed session, but its history is not
// written again.
import { definePty } from "../../pty/run"
import { config, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini", "--no-replay"],
  cols: 60,
  rows: 16,
  server: server(),
  setup: (root) => config(root),
  steps: [
    { until: { screen: "oc mini" }, settle: 800, timeout: 30_000, checkpoint: "cleared" },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask],
})
