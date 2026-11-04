// The live stream carries only the promotion: text, reasoning (hidden without --thinking), a tool and the
// step come from the message list after the wait.
import { defineCli } from "../../cli/run"
import { assistant, server } from "./fixture"

export const content = [
  { type: "reasoning", text: "hmm" },
  { type: "text", text: "From the list." },
  {
    type: "tool",
    id: "call_9",
    name: "glob",
    state: {
      status: "completed",
      input: { pattern: "*.ts" },
      metadata: { count: 2 },
      content: [{ type: "text", text: "a.ts\nb.ts" }],
    },
    time: { created: 14, ran: 15, completed: 16 },
  },
]

export default defineCli({
  args: ["run", "hello"],
  server: server({ messages: [assistant(content)] }),
})
