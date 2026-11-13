// OT2064 (parity/deviations/OT2064-extmark-mouse.md): the mouse ends inside an `[Image 1]` label. TS leaves the
// cursor there, so typed text goes into the label; Rust moves it to the label's nearer edge (a click, a drag) or to
// its end (a double-click, then Right).
import { definePty } from "../../pty/run"
import { home, homeMasks, move, paste, press, release } from "./home"

// A 1x1 PNG.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const deviation = { file: "OT2064-extmark-mouse", lines: 2 }

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  setup: async (root) => {
    await Bun.write(`${root}/work/img.png`, Buffer.from(png, "base64"))
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "a ", settle: 300 },
    { keys: paste("img.png"), until: { screen: "[Image 1]" }, settle: 600 },
    { keys: "b", settle: 300, checkpoint: "label" },
    // Row 17, columns 19 to 27 hold the label.
    { keys: press(22, 17), settle: 200, checkpoint: "pressed" },
    { keys: release(22, 17), settle: 400, checkpoint: "clicked", deviation: { ...deviation, lines: 1 } },
    { keys: "X", settle: 400, checkpoint: "click-typed", deviation },
    { keys: "\x7f", settle: 300 },
    { keys: press(16, 17), settle: 100 },
    { keys: move(19, 17) + move(22, 17), settle: 100 },
    { keys: release(22, 17), settle: 400, checkpoint: "dragged", deviation: { ...deviation, lines: 1 } },
    { keys: "\x1b[C", settle: 200 },
    { keys: press(25, 17) + release(25, 17), settle: 200 },
    { keys: press(25, 17) + release(25, 17), settle: 400, checkpoint: "double" },
    { keys: "\x1b[C", settle: 300 },
    { keys: "Y", settle: 400, checkpoint: "double-typed", deviation },
  ],
  cursor: true,
  osc: [],
  masks: homeMasks,
})
