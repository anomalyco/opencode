// `api session.remove --param sessionID=...`: a DELETE answered with 204 prints nothing, exit 0.
import { defineCli } from "../../cli/run"
import { openapi } from "./fixture"

export default defineCli({
  args: ["api", "session.remove", "--param", "sessionID=ses_abcdef"],
  server: { routes: [openapi, { method: "DELETE", path: "/api/session/:id", status: 204 }] },
})
