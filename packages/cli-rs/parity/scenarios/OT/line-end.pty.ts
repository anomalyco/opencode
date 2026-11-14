// OT2053 (parity/deviations/OT2053-no-wrap-line-end.md): the command palette's search field holds more text than it
// shows. After Ctrl+A, `input.visual.line.end` (Alt+E) leaves the TS cursor at the start, so `X` goes in front;
// Rust moves to the end of the text.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "\x10", until: { screen: "Search commands" }, settle: 500 },
    { keys: "abcdefghij".repeat(9), settle: 500, checkpoint: "typed" },
    { keys: "\x01", settle: 300, checkpoint: "start" },
    { keys: "\x1be", settle: 300 },
    { keys: "X", settle: 500, checkpoint: "end", deviation: { file: "OT2053-no-wrap-line-end", lines: 1 } },
  ],
  masks: homeMasks,
})
