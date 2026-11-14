// `stats --year 2020 --full` on a 120-column terminal with NO_COLOR: the table layouts of the detail sections.
import { definePty } from "../../pty/run"
import { statsRoute, year2020 } from "./fixture"

export default definePty({
  args: ["stats", "--year", "2020", "--full"],
  cols: 120,
  rows: 40,
  env: { TZ: "UTC", NO_COLOR: "1", COLORFGBG: "0;15" },
  server: { routes: [statsRoute(year2020)] },
  steps: [{ until: { screen: "unfinished" }, settle: 300, checkpoint: "details", timeout: 30_000 }],
  osc: [],
  exits: true,
  requests: true,
})
