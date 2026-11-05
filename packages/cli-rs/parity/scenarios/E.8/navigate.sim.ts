// P-TUI version of `E.8/navigate.app.ts`: scrolling and navigation over eight turns the server ran (V06). Page up
// shows "Jump to latest", session.first goes to the first message, session.last back to the bottom, and
// session.messages_last_user aligns the last question with the top. Each reply groups its two reads under
// "Explored".
import { defineSim } from "../../sim/scenario"

const turns = Array.from({ length: 8 }, (_, index) => index + 1)
const read = (index: number, path: string) => ({
  type: "toolCall" as const,
  index,
  id: `call_${index}`,
  name: "read",
  input: { path },
})
const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const deviation = ["P15-metadata-gap-fg"]

export default defineSim({
  files: { "src/a.rs": "fn a() {}\n", "src/b.rs": "fn b() {}\n" },
  sessions: [{ title: "Navigate", prompts: turns.map((turn) => `Question ${turn}`) }],
  args: ["--session", "$session:0"],
  model: turns.flatMap((turn) => [
    { items: [read(0, "src/a.rs"), read(1, "src/b.rs")], finish: "tool-calls" as const },
    {
      items: [
        { type: "textDelta" as const, text: `Answer ${turn} one.\n\nAnswer ${turn} two.\n\nAnswer ${turn} three.` },
      ],
    },
  ]),
  steps: [
    // The TS footer shows "Finishing startup…" until startup ends, then the working directory.
    { until: "/work " },
    { checkpoint: "open", until: "Answer 8 three.", masks: [duration], deviation },
    // The drive protocol names no Page Up key, so the legacy sequence goes through as is on both sides.
    { press: "\x1b[5~" },
    { checkpoint: "page-up", until: "Jump to latest", masks: [duration], deviation },
    { press: "g", modifiers: { ctrl: true } },
    { checkpoint: "first", until: "Question 1", masks: [duration], deviation },
    { press: "end" },
    { checkpoint: "last", until: "Answer 8 three.", masks: [duration], deviation },
    { press: "end", modifiers: { meta: true } },
    { checkpoint: "last-user", until: "Jump to latest", masks: [duration], deviation },
  ],
})
