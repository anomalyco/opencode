// A declared 400 from the stats endpoint: the bare message, exit 1.
import { defineCli } from "../../cli/run"
import { statsRoute } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020"],
  env: { TZ: "UTC" },
  server: {
    routes: [statsRoute({ _tag: "InvalidRequestError", message: "Stats range must end after it starts" }, 400)],
  },
})
