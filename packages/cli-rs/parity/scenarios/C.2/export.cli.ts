// `session export <id> --sanitize`: the transfer data, pretty-printed.
import { defineCli } from "../../cli/run"
import { exportRoute } from "./fixture"

export default defineCli({
  args: ["session", "export", "ses_aaaaaaaa0001", "--sanitize"],
  server: { routes: [exportRoute()] },
})
