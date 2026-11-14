// gh-triage-2012: a tab is two cells in the editor. On `ab\tcd`, Left then Down moves the cursor to the end of the
// text, so `X` goes after `d`. A client that measures the end with its own width count stops before `d`.
import { definePty } from "../../pty/run"
import { home, homeMasks, paste } from "./home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: paste("ab\tcd"), settle: 500, checkpoint: "pasted" },
    { keys: "\x1b[D", settle: 300 },
    { keys: "\x1b[B", settle: 300 },
    { keys: "X", settle: 500, checkpoint: "typed" },
  ],
  masks: homeMasks,
})
