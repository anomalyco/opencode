// `--replay-limit 0` is rejected before anything is drawn.
import { definePty } from "../../pty/run"

export default definePty({
  args: ["mini", "--replay-limit", "0"],
  cols: 80,
  rows: 6,
  server: { routes: [] },
  steps: [{ until: { screen: "Error" }, settle: 300, checkpoint: "error" }],
  exits: true,
})
