// As `step-failed`, in JSON.
import { defineCli } from "../../cli/run"
import { event, server } from "./fixture"
import { failed } from "./step-failed.cli"

export default defineCli({
  args: ["run", "--format", "json", "hello"],
  server: server({ events: () => failed, end: event("session.execution.failed", { error: { type: "provider", message: "rate limited" } }, 13) }),
})
