// With `prompt.image_preview`, a pasted image shows a preview above the composer, which grows by its rows.
import { definePty } from "../../pty/run"
import { leave, opened, server, statusMask } from "./fixture"

// A 1x1 PNG.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: server(),
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ prompt: { image_preview: true }, mini: { splash: "hide" } }),
    )
    await Bun.write(`${root}/work/img.png`, Buffer.from(png, "base64"))
  },
  steps: [
    opened,
    { keys: "look at ", settle: 200 },
    { keys: "\x1b[200~img.png\x1b[201~", settle: 600, checkpoint: "previewed" },
    { keys: "\x03", settle: 300, checkpoint: "cleared" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
})
