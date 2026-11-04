// A request already pending when the prompt is admitted (the list after the prompt) is rejected too;
// `--yolo` is the hidden spelling of `--auto`.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "--yolo", "hello"],
  server: server({
    events: () => textStep("ok"),
    routes: [
      { path: "/api/session/ses_run/permission", json: { data: [{ id: "per_2", sessionID: "ses_run", action: "bash", resources: ["ls"] }] } },
      { method: "POST", path: "/api/session/ses_run/permission/per_2/reply", status: 204 },
    ],
  }),
})
