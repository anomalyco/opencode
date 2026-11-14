// `session list` on a terminal pages through `less -R -S`: long lines are cut, not wrapped, and `q`
// quits with exit 0.
import { definePty } from "../../pty/run"
import { list, location, session, sessions } from "./fixture"

export default definePty({
  args: ["session", "list"],
  cols: 60,
  rows: 10,
  server: {
    routes: [
      location,
      list([
        ...sessions,
        session("ses_ffffffff0006", "A title that is far too long to fit in sixty columns", 1_600_000_000_000),
      ]),
    ],
  },
  steps: [
    { until: { screen: "Fix the parser" }, settle: 300, checkpoint: "paged", timeout: 30_000 },
    { keys: "q", settle: 300 },
  ],
  osc: [],
  exits: true,
  requests: true,
})
