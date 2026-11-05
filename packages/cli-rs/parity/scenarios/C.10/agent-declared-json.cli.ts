// `run --format json --agent nope`: the agent switch gets a declared error (400). The JSON error event has
// its message without the tag, as `errorMessage` gives it.
import { defineCli } from "../../cli/run"
import { nowMask, server } from "./fixture"

export default defineCli({
  args: ["run", "--format", "json", "--agent", "nope", "hello"],
  server: server({
    routes: [
      {
        method: "POST",
        path: "/api/session/ses_run/agent",
        status: 400,
        json: { _tag: "InvalidRequestError", message: "Unknown agent: nope" },
      },
    ],
  }),
  masks: [nowMask],
})
