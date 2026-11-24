// Two `[Image 1]` labels with the space between them deleted. From the end of the second, Left skips only the second
// label; from the line start, two Rights skip only the first (OpenTUI #2104, on both sides since 0.9.4). A typed key
// shows where the cursor is.
import { definePty } from "../../pty/run"
import { home, homeMasks, paste } from "./home"

// A 1x1 PNG.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

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
    // The same image again: both clients label it `[Image 1]` again.
    { keys: paste("img.png"), until: { screen: "] [Image 1]" }, settle: 600 },
    // Left over the space after the second label, Left before it, Delete the space between the labels.
    { keys: "\x1b[D", settle: 300 },
    { keys: "\x1b[D", settle: 300 },
    { keys: "\x1b[3~", settle: 400, checkpoint: "joined" },
    // Between the labels, Delete and Backspace each delete one label, and undo (Ctrl+-) brings it back: equal.
    { keys: "\x1b[3~", settle: 400, checkpoint: "deleted" },
    { keys: "\x1b[45;5u", settle: 400, checkpoint: "delete-undone" },
    { keys: "\x7f", settle: 400, checkpoint: "backspaced" },
    { keys: "\x1b[45;5u", settle: 400, checkpoint: "backspace-undone" },
    { keys: "\x1b[C", settle: 300, checkpoint: "right-from-joint" },
    { keys: "\x1b[D", settle: 300, checkpoint: "left-pair" },
    { keys: "X", settle: 400, checkpoint: "left-typed" },
    { keys: "\x7f", settle: 300 },
    { keys: "\x1b[H", settle: 300 },
    { keys: "\x1b[C", settle: 300 },
    { keys: "\x1b[C", settle: 300, checkpoint: "right-pair" },
    { keys: "Y", settle: 400, checkpoint: "right-typed" },
  ],
  cursor: true,
  osc: [],
  masks: homeMasks,
})
