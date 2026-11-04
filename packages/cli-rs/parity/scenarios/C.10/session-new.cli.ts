// `-s ses_named` that the server does not know: the session is created with that ID.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "-s", "ses_named", "hi"],
  server: server({
    sessionID: "ses_named",
    events: () => textStep("ok"),
    routes: [{ path: "/api/session/ses_named", status: 404, json: { _tag: "SessionNotFoundError", message: "nope" } }],
  }),
})
