// `stats --year 2020`: a past calendar year, so the range is fixed (TZ=UTC). Not a terminal: no color and
// the 80-column default. The summary asks for tool totals only.
import { defineCli } from "../../cli/run"
import { statsRoute, year2020 } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020"],
  env: { TZ: "UTC", COLORFGBG: "15;0" },
  server: { routes: [statsRoute(year2020)] },
})
