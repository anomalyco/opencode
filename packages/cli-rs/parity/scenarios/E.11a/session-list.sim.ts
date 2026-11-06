// P-TUI version of `E.11a/session-list.app.ts`: two sessions created on the server, then listed over the home
// (DLG16): opened with <leader>l, the first delete press marks the row, the second deletes the session on the
// server. The whole screen is compared except the home's placeholder row.
import { defineSim } from "../../sim/scenario"

const placeholder = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
}
const leader = { press: "x", modifiers: { ctrl: true } } as const
const remove = { press: "d", modifiers: { ctrl: true } } as const

export default defineSim({
  sessions: [
    { title: "Write docs", prompts: [] },
    { title: "Fix the parser", prompts: [] },
  ],
  model: [],
  steps: [
    { checkpoint: "home", until: "Simulated Model", masks: [placeholder] },
    leader,
    { press: "l" },
    { checkpoint: "list", until: "Write docs" },
    remove,
    { checkpoint: "marked", until: "again to confirm" },
    remove,
    { checkpoint: "deleted", until: "delete ctrl+d" },
  ],
})
