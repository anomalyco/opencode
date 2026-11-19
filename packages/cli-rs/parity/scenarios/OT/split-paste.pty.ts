// A bracketed paste whose start marker arrives in two reads, 300 ms apart. The client waits for the rest of the
// marker and inserts the paste whole, on two rows, so the prompt grows by one (OpenTUI #2046, on both sides since
// 0.9.4).
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "hi ", until: { screen: "hi" }, settle: 200, checkpoint: "typed" },
    { keys: "\x1b[20", settle: 300 },
    { keys: "0~one\rtwo\x1b[201~", settle: 800, checkpoint: "pasted" },
  ],
  masks: homeMasks,
})
