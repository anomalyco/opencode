// The initial value, hints on the focused option, wrap-around with arrows and J and K.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("select"),
  cols: 60,
  rows: 14,
  steps: [
    { until: { screen: "Provider" }, settle: 250, checkpoint: "initial" },
    press("\x1b[B", "down"),
    press("jj", "wrapped"),
    press("\x1b[A", "up"),
    press("\r", "submitted", "value:"),
  ],
  exits: true,
})
