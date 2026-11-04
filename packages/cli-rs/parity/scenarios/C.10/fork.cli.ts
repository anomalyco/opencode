// `-s ses_old --fork --archived --format json`: the session is forked, and the fork archived.
import { defineCli } from "../../cli/run"
import { server, session, textStep } from "./fixture"

export default defineCli({
  args: ["run", "-s", "ses_old", "--fork", "--archived", "--format", "json", "again"],
  server: server({
    sessionID: "ses_fork",
    events: () => textStep("ok"),
    routes: [
      {
        path: "/api/session/ses_old",
        json: { data: session("ses_old", { agent: "build", model: { providerID: "demo", id: "model" } }) },
      },
      {
        method: "POST",
        path: "/api/session/ses_old/fork",
        json: { data: session("ses_fork", { agent: "build", model: { providerID: "demo", id: "model" } }) },
      },
      { method: "POST", path: "/api/session/ses_fork/agent", status: 204 },
      { method: "POST", path: "/api/session/ses_fork/model", status: 204 },
      { method: "PATCH", path: "/api/session/ses_fork", status: 204 },
    ],
  }),
})
