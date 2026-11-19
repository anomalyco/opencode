// One long paragraph wraps past the prompt's height, and the wheel steps up over it. The view scrolls through the
// rows and the cursor moves up with them, so `Q` lands mid-paragraph (OpenTUI #2076, on both sides since 0.9.4).
import { definePty } from "../../pty/run"
import { home, homeMasks, wheelUp } from "./home"

const words = Array.from({ length: 160 }, (_, index) => `w${String(index).padStart(3, "0")}`).join(" ")

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: words, until: { screen: "w159" }, settle: 500, checkpoint: "typed" },
    { keys: wheelUp(40, 20), settle: 400, checkpoint: "wheel" },
    { keys: wheelUp(40, 20), settle: 400 },
    { keys: wheelUp(40, 20), settle: 400 },
    { keys: "Q", settle: 400, checkpoint: "typed-after" },
  ],
  cursor: true,
  masks: homeMasks,
})
