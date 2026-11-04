// `run --thinking`: reasoning prints as a `Thinking:` line on stdout when it is a pipe.
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"

const reasoning = [
  event("session.reasoning.started", { assistantMessageID: "msg_a", ordinal: 0 }, 12),
  event("session.reasoning.ended", { assistantMessageID: "msg_a", ordinal: 0, text: "  Let me look.  " }, 12),
]

export default defineCli({
  args: ["run", "--thinking", "hello"],
  server: server({ events: () => textStep("Done.", reasoning) }),
})
