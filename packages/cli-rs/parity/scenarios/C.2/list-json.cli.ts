// `session list -n 2 --format json`: the summary fields, a missing title left out.
import { defineCli } from "../../cli/run"
import { list, location, sessions } from "./fixture"

export default defineCli({
  args: ["session", "list", "-n", "2", "--format", "json"],
  server: { routes: [location, list(sessions)] },
})
