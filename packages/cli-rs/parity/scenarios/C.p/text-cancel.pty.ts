// Ctrl+C cancels: the struck-through input, then `cancel("Cancelled")` and exit 130.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("text"),
  cols: 60,
  rows: 12,
  steps: [
    { until: { screen: "Your name" }, settle: 250 },
    press("abc", "typed"),
    press("\x03", "cancelled", "Cancelled"),
  ],
  exits: true,
})
