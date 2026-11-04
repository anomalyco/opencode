// `OPENCODE_SHOW_TTFD=1` on a new session: the time to the first frame is the first row of the transcript.
import { definePty } from "../../pty/run"
import { config, server, statusMask } from "./fixture"

export default definePty({
  args: ["mini"],
  cols: 60,
  rows: 10,
  env: { OPENCODE_SHOW_TTFD: "1" },
  server: server(),
  setup: (root) => config(root),
  steps: [
    { until: { screen: /startup \d+ms/ }, settle: 600, timeout: 30_000, checkpoint: "startup" },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 400 },
  ],
  exits: true,
  masks: [statusMask, { pattern: /startup \d+ms/, reason: "the time differs per run" }],
})
