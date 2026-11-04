// `stats --year 2020 --json`: the server's statistics as they came, two-space indented, with tool details.
import { defineCli } from "../../cli/run"
import { statsRoute, year2020 } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020", "--json"],
  env: { TZ: "UTC" },
  server: { routes: [statsRoute(year2020)] },
})
