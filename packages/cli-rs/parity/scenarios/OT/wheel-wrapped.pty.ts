// OT2076 (parity/deviations/OT2076-wheel-wrapped-row.md): one long paragraph wraps past the prompt's height, and the
// wheel steps up over it. In TS the view and the cursor stay at the end, so `Q` goes after the last word; Rust
// scrolls through the rows and moves the cursor up with them, so `Q` lands mid-paragraph.
import { definePty } from "../../pty/run"
import { home, homeMasks, wheelUp } from "./home"

const words = Array.from({ length: 160 }, (_, index) => `w${String(index).padStart(3, "0")}`).join(" ")
const deviation = { file: "OT2076-wheel-wrapped-row", lines: 12 }

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: words, until: { screen: "w159" }, settle: 500, checkpoint: "typed" },
    { keys: wheelUp(40, 20), settle: 400, checkpoint: "wheel", deviation },
    { keys: wheelUp(40, 20), settle: 400 },
    { keys: wheelUp(40, 20), settle: 400 },
    { keys: "Q", settle: 400, checkpoint: "typed-after", deviation },
  ],
  cursor: true,
  masks: homeMasks,
})
