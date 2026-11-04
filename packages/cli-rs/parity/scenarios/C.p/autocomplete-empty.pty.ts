// No match: Enter submits nothing (`undefined`); Escape on another run cancels.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("autocomplete"),
  cols: 60,
  rows: 20,
  steps: [
    { until: { screen: "Search" }, settle: 250 },
    press("zzz", "no matches", "No matches"),
    press("\r", "submitted", "value:"),
  ],
  exits: true,
})
