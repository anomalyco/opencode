// Flag errors under a terminal: `--fork` without a session to fork.
import { definePty } from "../../pty/run"

export default definePty({
  args: ["mini", "--fork"],
  cols: 80,
  rows: 6,
  server: { routes: [] },
  steps: [{ until: { screen: "Error" }, settle: 300, checkpoint: "error" }],
  exits: true,
})
