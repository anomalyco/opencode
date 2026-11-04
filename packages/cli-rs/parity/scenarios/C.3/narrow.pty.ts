// `stats --year 2020` on a 50-column terminal with a dark COLORFGBG: the calendar clips to the latest 46
// weeks. Colors do not show in the screen text; the C.3 oracle compares the escapes.
import { definePty } from "../../pty/run"
import { statsRoute, year2020 } from "./fixture"

export default definePty({
  args: ["stats", "--year", "2020"],
  cols: 50,
  rows: 30,
  env: { TZ: "UTC", COLORFGBG: "15;0" },
  server: { routes: [statsRoute(year2020)] },
  steps: [{ until: { screen: "opencode.ai" }, settle: 300, checkpoint: "card", timeout: 30_000 }],
  osc: [],
  exits: true,
  requests: true,
})
