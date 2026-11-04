// An undeclared 500 from the stats endpoint: the client error's message, exit 1.
import { defineCli } from "../../cli/run"
import { statsRoute } from "./fixture"

export default defineCli({
  args: ["stats", "--year", "2020"],
  env: { TZ: "UTC" },
  server: { routes: [statsRoute({ message: "boom" }, 500)] },
})
