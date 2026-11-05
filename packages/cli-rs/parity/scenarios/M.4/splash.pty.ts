// `mini.splash: show`: the transcript starts under the entry header, and leaving writes the exit banner with the
// session's title and the command that resumes it.
import { definePty } from "../../pty/run"
import { config } from "./fixture"
import { server } from "../M.2/fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 24,
  server: server(),
  setup: (root) => config(root, { splash: "show" }),
  steps: [
    { until: { screen: "Third answer" }, settle: 1_200, timeout: 30_000, checkpoint: "entry", scrollback: 4 },
    { keys: "\x03", settle: 200 },
    { keys: "\x03", settle: 800, checkpoint: "exit" },
  ],
  exits: true,
  masks: [
    {
      pattern: /^(ctrl\+x q \d+ pending · )?build · model · demo( · ctrl\+p menu)?$/,
      reason: "the status row is not under test",
    },
  ],
})
