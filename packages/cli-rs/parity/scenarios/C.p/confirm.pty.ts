// Arrows flip the answer, Enter submits; Y answers the second prompt at once.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("confirm"),
  cols: 50,
  rows: 14,
  steps: [
    { until: { screen: "Continue?" }, settle: 250, checkpoint: "initial" },
    press("\x1b[C", "flipped"),
    press("l", "flipped back"),
    press("\r", "second", "Delete it?"),
    press("y", "answered", "value: true\n"),
  ],
  exits: true,
})
