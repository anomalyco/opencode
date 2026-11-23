// A list longer than `maxItems`: the window follows the cursor with "..." rows, and wraps around.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("select-long"),
  cols: 40,
  rows: 20,
  steps: [
    { until: { screen: "Pick one" }, settle: 250, checkpoint: "top" },
    press("jjjjjj", "middle"),
    press("\x1b[A".repeat(8), "wrapped to the end"),
    press("\r", "submitted", "value:"),
  ],
  exits: true,
})
