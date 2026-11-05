// P-TUI version of `E.11a/session-list.app.ts`: two sessions created on the server, then listed over the home
// (DLG16): opened with <leader>l, the first delete press marks the row, the second deletes the session on the
// server. The masks keep the comparison to the dialog panel (x 6-93, y 8-18 at 100x30): the home's prompt behind
// it is E.2's (T17-home-prompt).
import { defineSim } from "../../sim/scenario"

const reason = "outside the dialog panel: the home prompt behind it differs (T17-home-prompt)"
// The panel's rows: 11 with two sessions, 10 once one is deleted.
const panel = (rows: number) => [
  { x: 0, y: 0, width: 100, height: 8, reason },
  { x: 0, y: 8 + rows, width: 100, height: 22 - rows, reason },
  { x: 0, y: 8, width: 6, height: rows, reason },
  { x: 94, y: 8, width: 6, height: rows, reason },
]
const leader = { press: "x", modifiers: { ctrl: true } } as const
const remove = { press: "d", modifiers: { ctrl: true } } as const

export default defineSim({
  sessions: [
    { title: "Write docs", prompts: [] },
    { title: "Fix the parser", prompts: [] },
  ],
  model: [],
  steps: [
    { checkpoint: "home", until: "Simulated Model", masks: [{ x: 0, y: 0, width: 100, height: 30, reason }] },
    leader,
    { press: "l" },
    { checkpoint: "list", until: "Write docs", masks: panel(11) },
    remove,
    { checkpoint: "marked", until: "again to confirm", masks: panel(11) },
    remove,
    { checkpoint: "deleted", until: "delete ctrl+d", masks: panel(10) },
  ],
})
