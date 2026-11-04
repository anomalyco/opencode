// `run hello`: a step with text and a read tool, printed as text (stdout is a pipe, so the text goes there
// and the step and tool lines go to stderr).
import { defineCli } from "../../cli/run"
import { event, server, textStep } from "./fixture"

export const read = [
  event("session.tool.input.started", { assistantMessageID: "msg_a", id: "call_1", name: "read" }, 14),
  event(
    "session.tool.called",
    {
      assistantMessageID: "msg_a",
      id: "call_1",
      input: { filePath: "/tmp/run/src/a.ts", offset: 1, limit: 20 },
      executed: false,
    },
    15,
  ),
  event(
    "session.tool.success",
    {
      assistantMessageID: "msg_a",
      id: "call_1",
      content: [{ type: "text", text: "1: const a = 1" }],
      metadata: {},
      executed: false,
    },
    16,
  ),
]

export default defineCli({
  args: ["run", "hello", "world"],
  server: server({ events: () => textStep("Hello there.", read) }),
})
