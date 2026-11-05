// P-TUI version of `E.6b/messages.app.ts`: message kinds built by real turns (V08, V10, V11). A session opens with
// one finished turn; `/compact` runs a real compaction (its summary must use the template's headings); a prompt
// whose step fails with a provider error, with its toast; another prompt, then `/undo` shows the revert banner. The
// step waiting to retry is left out: a retry waits for its backoff in real time.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const deviation = ["P15-metadata-gap-fg"]

export default defineSim({
  height: 40,
  sessions: [{ title: "Fix the parser", prompts: ["Why does the parser fail?"] }],
  args: ["--session", "$session:0"],
  model: [
    { items: [{ type: "textDelta", text: "Reading the parser." }] },
    { items: [{ type: "textDelta", text: "## Objective\n- Fix the **parser**." }] },
    { items: [{ type: "raw", chunk: { error: { message: "Request too large" } } }], finish: false },
    { items: [{ type: "textDelta", text: "Rewrote the lexer." }] },
  ],
  steps: [
    // The TS footer shows "Finishing startup…" until startup ends, then the working directory.
    { until: "/work " },
    { until: "Simulated Model" },
    { type: "/compact" },
    { until: "/compact" },
    { enter: true },
    { checkpoint: "compacted", until: "Fix the parser.", masks: [duration], deviation },
    { type: "Try again" },
    { until: "Try again" },
    { enter: true },
    { checkpoint: "failed", until: "Request too large", masks: [duration], deviation },
    { type: "Rewrite the lexer" },
    { until: "Rewrite the lexer" },
    { enter: true },
    { until: "Rewrote the lexer." },
    { type: "/undo" },
    { until: "/undo" },
    { enter: true },
    { checkpoint: "reverted", until: "reverted", masks: [duration], deviation },
  ],
})
