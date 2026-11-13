// With `terminal.title` off and no plugin title, the TUI sets no title, and exiting still clears it, as TS's
// `destroyRenderer` clears the title whatever the setting. The counterpart of title-off.pty.ts without the plugin.
// Only the title OSC log is compared.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { definePty } from "../../pty/run"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  setup: async (root) => {
    const config = path.join(root, "home/.config/opencode")
    await mkdir(config, { recursive: true })
    await writeFile(path.join(config, "cli.json"), JSON.stringify({ terminal: { title: false } }))
  },
  steps: [{ until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 }, { keys: "\x03", settle: 300 }, { keys: "\x03" }],
  osc: ["title"],
  exits: true,
})
