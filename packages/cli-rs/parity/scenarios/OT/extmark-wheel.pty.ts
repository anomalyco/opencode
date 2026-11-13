// OT2064 (parity/deviations/OT2064-extmark-mouse.md): wheel steps up a prompt of short lines that do not wrap, with
// the cursor at column 8 of each line, until the cursor reaches the line whose `[Image 1]` label spans that column.
// TS leaves the cursor inside the label, so `X` goes into it; Rust moves it to the label's start.
import { definePty } from "../../pty/run"
import { home, homeMasks, paste, wheelUp } from "./home"

const deviation = { file: "OT2064-extmark-mouse", lines: 2 }
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const lines = (from: number) =>
  Array.from({ length: 12 }, (_, index) => `\nline ${String(from + index).padStart(2, "0")}x`).join("")

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
    { keys: "line 00x" + lines(1) + "\ntop ", until: { screen: "top" }, settle: 300 },
    { keys: paste("img.png"), until: { screen: "[Image 1]" }, settle: 600 },
    { keys: " end", settle: 300 },
    { keys: lines(13), until: { screen: "line 24x" }, settle: 500, checkpoint: "typed" },
    ...Array.from({ length: 9 }, () => ({ keys: wheelUp(40, 20), settle: 200 })),
    { keys: "", settle: 200, checkpoint: "above" },
    { keys: wheelUp(40, 20), settle: 400, checkpoint: "on-label", deviation },
    { keys: "X", settle: 400, checkpoint: "label-typed", deviation },
  ],
  cursor: true,
  masks: homeMasks,
})
