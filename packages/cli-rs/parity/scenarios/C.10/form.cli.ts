// Any other form is cancelled and ends the run with exit code 1; the server says it is already settled.
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "hello"],
  server: server({
    events: () => [
      event("form.created", { form: { id: "frm_2", sessionID: "ses_run", metadata: { kind: "mcp" }, fields: [] } }, 12),
      ...textStep("Stopped."),
    ],
    routes: [
      {
        method: "DELETE",
        path: "/api/session/ses_run/form/frm_2",
        status: 409,
        json: { _tag: "FormAlreadySettledError", message: "settled" },
      },
    ],
  }),
})
