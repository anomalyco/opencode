// `stats --year 2020 --tools` against a server that sent no tool details: the section says so.
import { defineCli } from "../../cli/run"
import { stats, statsRoute } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020", "--tools"],
  env: { TZ: "UTC" },
  server: { routes: [statsRoute(stats(Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1), "summary"))] },
})
