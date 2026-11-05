// P-TUI version of `H.2/session-open.app.ts`: `-s <id>` opens a session whose first turn ran on the server, then
// a second prompt streams its reply through the real event stream: the first part while the step runs, the rest
// after it.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }

export default defineSim({
  sessions: [{ title: "Fix the parser", prompts: ["Why does the parser fail?"] }],
  args: ["--session", "$session:0"],
  model: [
    { items: [{ type: "textDelta", text: "The parser drops the last token." }] },
    {
      items: [
        { type: "textDelta", text: "Moving the bound." },
        { hold: "stream" },
        { type: "textDelta", text: " Fixed." },
      ],
    },
  ],
  steps: [
    // The TS footer shows "Finishing startup…" until startup ends, then the working directory.
    { until: "/work " },
    {
      checkpoint: "open",
      until: "The parser drops the last token.",
      masks: [duration],
      deviation: ["P15-metadata-gap-fg"],
    },
    { until: "Simulated Model" },
    { type: "Fix it" },
    { until: "Fix it" },
    { enter: true },
    { checkpoint: "streaming", until: "Moving the bound.", masks: [duration], deviation: ["P15-metadata-gap-fg"] },
    { release: "stream" },
    { checkpoint: "streamed", until: "Fixed.", masks: [duration], deviation: ["P15-metadata-gap-fg"] },
  ],
})
