// A terminal narrower than the rows: frames wrap and redraw from the first changed line.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("select"),
  cols: 18,
  rows: 14,
  steps: [
    { until: { screen: "Provider" }, settle: 250, checkpoint: "initial" },
    press("\x1b[A", "up"),
    press("\x1b[A", "first"),
    press("\r", "submitted", "value:"),
  ],
  exits: true,
})
