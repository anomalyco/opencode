// Typing filters with a match count, arrows navigate (and then typing shows dim), no matches, submit.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("autocomplete"),
  cols: 70,
  rows: 24,
  steps: [
    { until: { screen: "Search" }, settle: 250, checkpoint: "initial" },
    press("go", "filtered"),
    press("\x7f\x7fitem 1", "item 1"),
    press("\x1b[B\x1b[B", "navigated"),
    press("x", "typed while navigating"),
    press("\x7f\r", "submitted", "value:"),
  ],
  exits: true,
})
