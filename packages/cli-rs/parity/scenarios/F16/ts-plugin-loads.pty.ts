// O-166: the JS host is on by default. A TypeScript TUI plugin in the global `plugins` directory, with no variable set,
// loads in both clients: TS runs it in its own process, opencode-native on the JS host (Bun on the path), and
// `/plugins` lists `parity.energy` active, with no notice (`F16-typescript-plugins-skipped`).
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { definePty } from "../../pty/run"

const plugin = `export default {
  id: "parity.energy",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{ id: "energy.show", title: "Energy: Show emissions", palette: true, run() {} }],
    }))
  },
}
`

export default definePty({
  args: [],
  cols: 120,
  rows: 30,
  server: { fallback: "tui", routes: [] },
  setup: async (root) => {
    const config = path.join(root, "home/.config/opencode")
    await mkdir(path.join(config, "plugins/energy"), { recursive: true })
    await writeFile(path.join(config, "plugins/energy/tui.ts"), plugin)
    const cli = { experimental: { "new-designs": true }, animations: false, debug: { devtools: false } }
    await writeFile(path.join(config, "cli.json"), JSON.stringify(cli))
  },
  steps: [
    // TS shows "⋯ Finishing startup…" while it loads the plugin, longer under load: the home is compared after it.
    { until: { screen: /^(?![\s\S]*Finishing startup)[\s\S]*█▀▀█/ }, settle: 1_000, timeout: 30_000 },
    { checkpoint: "home" },
    { keys: "/plugins", until: { screen: "/plugins" }, settle: 300 },
    { keys: "\r", until: { screen: "parity.energy" }, settle: 1_000, timeout: 15_000 },
    { checkpoint: "plugins" },
  ],
  masks: [{ pattern: /Ask anything… .*$/, reason: "the placeholder example: random in TS and Rust" }],
  osc: [],
})
