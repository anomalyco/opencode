// P-TUI version of `E.2/running-reply.app.ts`: a reply while it runs. The step has started and nothing streamed
// yet, then reasoning streams in, then the reasoning ends and a shell call runs; the session is running
// throughout. The shell sleeps past the background hint's delay (3 s) and ends a moment later, so the side never
// leaves a command behind.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const deviation = ["P15-metadata-gap-fg"]

export default defineSim({
  model: [
    {
      items: [
        { hold: "waiting" },
        { type: "reasoningDelta", text: "**Planning the command**\n\nI will run echo." },
        { hold: "thinking" },
        {
          type: "toolCall",
          index: 0,
          id: "call_1",
          name: "shell",
          input: { command: "sleep 5; echo hello", description: "Print a greeting" },
        },
      ],
      finish: "tool-calls",
    },
    { items: [{ type: "textDelta", text: "All done." }] },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Run the shell command `echo hello` and then reply done" },
    { until: "reply done" },
    { enter: true },
    { checkpoint: "waiting", until: "esc interrupt", deviation },
    { release: "waiting" },
    { checkpoint: "thinking", until: "Planning the command", deviation },
    { release: "thinking" },
    { checkpoint: "shell", until: "to move running work", masks: [duration], deviation },
    { checkpoint: "done", until: "All done.", masks: [duration], deviation },
  ],
})
