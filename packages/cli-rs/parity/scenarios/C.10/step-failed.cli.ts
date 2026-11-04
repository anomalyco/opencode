// A failed step prints the error and exits 1.
import { defineCli } from "../../cli/run"
import { event, server } from "./fixture"

export const failed = [
  event("session.step.started", { assistantMessageID: "msg_a", agent: "build", model: { id: "model", providerID: "demo" }, started: 11 }, 11),
  event("session.step.failed", { assistantMessageID: "msg_a", error: { type: "provider", message: "Error: rate limited" } }, 12),
]

export default defineCli({
  args: ["run", "hello"],
  server: server({ events: () => failed, end: event("session.execution.failed", { error: { type: "provider", message: "rate limited" } }, 13) }),
})
