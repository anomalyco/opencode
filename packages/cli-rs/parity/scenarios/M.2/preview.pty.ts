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
  // A paste resolves its file off the input path and draws nothing until then, so each step waits for what it
  // checks; a quiet screen alone can come before a slow paste lands (as attach.pty.ts does).
  steps: [
    opened,
    { keys: "look at ", until: { screen: "┃ look at" }, settle: 200 },
    { keys: "\x1b[200~img.png\x1b[201~", until: { screen: "[Image 1]" }, settle: 600, checkpoint: "previewed" },
    { keys: "\x03", until: { gone: "look at" }, settle: 300, checkpoint: "cleared" },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
})
