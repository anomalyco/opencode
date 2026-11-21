// FT-10: a server plugin with a TUI part. TS loads that part from the server's list (`serverTuiPlugins`, here the
// directory `energy` beside `cli.json`, whose command shows in `/plugins` as an active TUI plugin). The JS host is on by
// default (O-166); here `OPENCODE_PLUGIN_JS=0` turns it off, so opencode-native does not load TypeScript TUI plugins,
// says so once in a notice with how to turn it back on, and lists the part as skipped (`F16-typescript-plugins-skipped`).
// `ts-plugin-loads` is the default.
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { definePty } from "../../pty/run"

const directory = "/tmp/opencode/packages/tui"
const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

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
  env: { OPENCODE_PLUGIN_JS: "0" },
  cols: 120,
  rows: 30,
  server: {
    fallback: "tui",
    routes: [
      {
        path: "/api/plugin",
        json: {
          location,
          data: [
            {
              id: "energy",
              source: { type: "local", path: "./energy" },
              features: { server: true, tui: true },
              state: { status: "active" },
            },
          ],
        },
      },
    ],
  },
  setup: async (root) => {
    const config = path.join(root, "home/.config/opencode")
    await mkdir(path.join(config, "energy"), { recursive: true })
    await writeFile(path.join(config, "energy/tui.ts"), plugin)
    const cli = { experimental: { "new-designs": true }, animations: false, debug: { devtools: false } }
    await writeFile(path.join(config, "cli.json"), JSON.stringify(cli))
  },
  steps: [
    // TS shows "⋯ Finishing startup…" in its footer while it loads the part, longer under load: an extra line the
    // checkpoints are compared after (f16-flake), as in `ts-plugin-loads`.
    { until: { screen: /^(?![\s\S]*Finishing startup)[\s\S]*█▀▀█/ }, settle: 1_000, timeout: 30_000 },
    // The notice, over the home's top rows.
    { checkpoint: "home", deviation: { file: "F16-typescript-plugins-skipped", lines: 8 } },
    { keys: "/plugins", until: { screen: "/plugins" }, settle: 300 },
    { keys: "\r", until: { screen: /^(?![\s\S]*Finishing startup)[\s\S]*Server/ }, settle: 1_000, timeout: 10_000 },
    // The notice, and the TUI row: `parity.energy` active in TS, `./energy` skipped with its error to view in Rust.
    { checkpoint: "plugins", deviation: { file: "F16-typescript-plugins-skipped", lines: 10 } },
  ],
  masks: [{ pattern: /Ask anything… .*$/, reason: "the placeholder example: random in TS and Rust" }],
  osc: [],
})
