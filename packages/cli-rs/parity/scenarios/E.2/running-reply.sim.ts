// P-TUI version of `E.2/running-reply.app.ts`: a reply while it runs. The step has started and nothing streamed
// yet, then reasoning streams in, then the reasoning ends and a shell call runs; the session is running
// throughout. The shell runs past the background hint's delay (3 s) until the step after its checkpoint writes `go`,
// so the running state lasts until it is captured however long a screen read takes (a TS `ui.matches` that goes
// unanswered is sent again after 2 s). It gives up after 30 s, so the side never leaves a command behind.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  config: { session: { verbosity: "medium" } },
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
          input: {
            command: "for i in $(seq 300); do [ -e go ] && break; sleep 0.1; done; echo hello",
            description: "Print a greeting",
          },
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
    { checkpoint: "waiting", until: "esc interrupt" },
    { release: "waiting" },
    { checkpoint: "thinking", until: "Planning the command" },
    { release: "thinking" },
    { checkpoint: "shell", until: "to move running work", masks: [duration] },
    { touch: "go" },
    { checkpoint: "done", until: "All done.", masks: [duration] },
  ],
})
