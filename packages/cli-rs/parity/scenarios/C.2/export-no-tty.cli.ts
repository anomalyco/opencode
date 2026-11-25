// `session export` without an ID and without a terminal fails before it connects.
import { defineCli } from "../../cli/run"
import { exportRoute } from "./fixture"

export default defineCli({ args: ["session", "export"], server: { routes: [exportRoute()] } })
