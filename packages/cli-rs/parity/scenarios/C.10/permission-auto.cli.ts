// `--auto` approves the request once, without a warning line.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"
import { ask } from "./permission.cli"

export default defineCli({
  args: ["run", "--auto", "hello"],
  server: server({
    events: () => [ask, ...textStep("Edited.")],
    routes: [{ method: "POST", path: "/api/session/ses_run/permission/per_1/reply", status: 204 }],
  }),
})
