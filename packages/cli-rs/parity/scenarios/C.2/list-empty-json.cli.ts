// `session list --format json` with no sessions prints `[]`.
import { defineCli } from "../../cli/run"
import { list, location } from "./fixture"

export default defineCli({ args: ["session", "list", "--format", "json"], server: { routes: [location, list([])] } })
