// `-w=feature --title "" --archived`: a worktree of the project, a new session in it titled after the
// message, archived before the prompt.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "-w=feature", "--title", "", "--archived", "a message that is longer than fifty characters in total, surely"],
  server: server({
    events: () => textStep("ok"),
    routes: [
      { method: "POST", path: "/api/worktree", json: { directory: "/tmp/wt/feature" } },
      { method: "PATCH", path: "/api/session/ses_run", status: 204 },
    ],
  }),
})
