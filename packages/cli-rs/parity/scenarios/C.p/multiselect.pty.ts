// Space toggles, A toggles all; a required list without a selection shows the error; an optional one
// submits "none".
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("multiselect"),
  cols: 70,
  rows: 24,
  steps: [
    { until: { screen: "Providers" }, settle: 250, checkpoint: "initial" },
    press(" ", "toggled first"),
    press("\x1b[B\x1b[B ", "untoggled google"),
    press(" ", "toggled google"),
    press("a", "all"),
    press("a", "none"),
    press("\r", "required", "Please select"),
    press("\x1b[B ", "fixed"),
    press("\r", "second", "Optional"),
    press("\r", "submitted", "none"),
  ],
  exits: true,
})
