// `run --agent nope`: the agent switch gets a declared error (400). stderr has its message without the
// tag, as `errorMessage` gives it.
import { defineCli } from "../../cli/run"
import { server } from "./fixture"

export default defineCli({
  args: ["run", "--agent", "nope", "hello"],
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
})
