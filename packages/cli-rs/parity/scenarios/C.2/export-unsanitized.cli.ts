// Without `--sanitize`, the query still says `sanitize=false`.
import { defineCli } from "../../cli/run"
import { exportRoute } from "./fixture"

export default defineCli({ args: ["session", "export", "ses_aaaaaaaa0001"], server: { routes: [exportRoute()] } })
