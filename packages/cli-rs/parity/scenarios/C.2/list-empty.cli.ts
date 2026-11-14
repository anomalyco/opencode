// `session list` with no sessions prints nothing; `--format json` prints `[]`.
import { defineCli } from "../../cli/run"
import { list, location } from "./fixture"

export default defineCli({ args: ["session", "list"], server: { routes: [location, list([])] } })
