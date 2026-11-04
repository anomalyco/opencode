// `stats --year 2020 --full --limit 2` on a 60-column terminal: the compact detail layouts and the
// "+N more" lines.
import { definePty } from "../../pty/run"
import { statsRoute, year2020 } from "./fixture"

export default definePty({
  args: ["stats", "--year", "2020", "--full", "--limit", "2"],
  cols: 60,
  rows: 40,
  env: { TZ: "UTC" },
  server: { routes: [statsRoute(year2020)] },
  steps: [{ until: { screen: "more tools" }, settle: 300, checkpoint: "details", timeout: 30_000 }],
  osc: [],
  exits: true,
  requests: true,
})
