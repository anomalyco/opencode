// An initial value, a validation error that clears on the next key, the default value for an empty
// answer, and a required field, cancelled with a lone Escape.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("text-validate"),
  cols: 60,
  rows: 16,
  steps: [
    { until: { screen: "Port" }, settle: 250, checkpoint: "initial" },
    press("x\r", "invalid", "Expected a number"),
    press("\x7f", "fixed"),
    press("\x15\r", "default", "Required"),
    press("\r", "required"),
    press("\x1b", "escape", "Cancelled"),
  ],
  exits: true,
})
