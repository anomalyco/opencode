// A scheduled retry prints a warning line, and the retried step starts once.
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"

export const retry = event(
  "session.retry.scheduled",
  {
    assistantMessageID: "msg_a",
    attempt: 1,
    at: 2003,
    error: { type: "provider.transport", message: "Recovered transport error" },
  },
  11,
)

export default defineCli({
  args: ["run", "hello"],
  server: server({ events: () => [textStep("ignored")[0], retry, ...textStep("Recovered.")] }),
})
