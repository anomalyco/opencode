// A pasted image path becomes an atomic `[Image 1]` part; Enter sends it as a file of the prompt.
import { definePty } from "../../pty/run"
import { config, leave, opened, server, statusMask } from "./fixture"

// A 1x1 PNG.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server(),
  setup: async (root) => {
    await config(root)
    await Bun.write(`${root}/work/img.png`, Buffer.from(png, "base64"))
  },
  steps: [
    opened,
    { keys: "look at ", settle: 200 },
    { keys: "\x1b[200~img.png\x1b[201~", settle: 600, checkpoint: "attached" },
    // Backspace removes the space, then the whole mark.
    { keys: "\x7f\x7f", settle: 300, checkpoint: "removed" },
    { keys: "\x1b[200~img.png\x1b[201~", settle: 600 },
    { keys: "\r", settle: 800, checkpoint: "sent" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
