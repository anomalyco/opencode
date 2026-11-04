// `stats --year 2020 --project . --full`: the project of the working directory, then every detail
// section (cost, models, tools) without the card.
import { defineCli } from "../../cli/run"
import { location, statsRoute, year2020 } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020", "--project", ".", "--full"],
  env: { TZ: "UTC" },
  server: { routes: [location, statsRoute(year2020)] },
})
