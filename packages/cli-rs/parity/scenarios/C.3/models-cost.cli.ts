// `stats --year 2020 --project <id> --models --cost --limit 1`: a selected project, no tool data asked
// for (`tools=none`), and a "+1 more model" line.
import { defineCli } from "../../cli/run"
import { stats, statsRoute } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020", "--project", "proj_selected", "--models", "--cost", "--limit", "1"],
  env: { TZ: "UTC" },
  server: { routes: [statsRoute(stats(Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1), "none"))] },
})
