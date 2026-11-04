// `run --format json --thinking`: text, reasoning, a read tool and the step, as JSON lines on stdout.
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"
import { read } from "./text.cli"

const reasoning = [
  event("session.reasoning.started", { assistantMessageID: "msg_a", ordinal: 0 }, 12),
  event(
    "session.reasoning.ended",
    { assistantMessageID: "msg_a", ordinal: 0, text: "Let me look.", native: { sig: "x" } },
    12,
  ),
]

export default defineCli({
  args: ["run", "--format", "json", "--thinking", "hello"],
  server: server({ events: () => textStep("Hello there.", [...reasoning, ...read]) }),
})
