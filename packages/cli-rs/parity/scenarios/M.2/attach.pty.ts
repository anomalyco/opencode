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
  // A paste resolves its file off the input path and draws nothing until then, so each step waits for what it
  // checks; a quiet screen alone can come before a slow paste lands.
  steps: [
    opened,
    { keys: "look at ", until: { screen: "┃ look at" }, settle: 200 },
    { keys: "\x1b[200~img.png\x1b[201~", until: { screen: "[Image 1]" }, settle: 600, checkpoint: "attached" },
    // Backspace removes the space, then the whole mark.
    { keys: "\x7f\x7f", until: { screen: /┃ look at\s*$/m }, settle: 300, checkpoint: "removed" },
    { keys: "\x1b[200~img.png\x1b[201~", until: { screen: "[Image 1]" }, settle: 600 },
    // The turn's summary row (`build · model · 0.2s`, not the status row's `… · demo`) ends the turn, so the
    // Ctrl+C that follows exits instead of interrupting.
    { keys: "\r", until: { screen: /^build · model · (?!demo)/m }, settle: 800, checkpoint: "sent" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
  requests: "writes",
})
