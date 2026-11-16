// FT-10: a server plugin with a TUI part. TS loads that part from the server's list (`serverTuiPlugins`, here the
// directory `energy` beside `cli.json`, whose command shows in `/plugins` as an active TUI plugin); opencode-native does
// not load TypeScript TUI plugins with the JS host off, says so once in a notice, and lists the part as skipped
// (`F16-typescript-plugins-skipped`).
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
    { until: { screen: "█▀▀█" }, settle: 1_000, timeout: 30_000 },
    // The notice, over the home's top rows.
    { checkpoint: "home", deviation: { file: "F16-typescript-plugins-skipped", lines: 8 } },
    { keys: "/plugins", until: { screen: "/plugins" }, settle: 300 },
    { keys: "\r", until: { screen: "Server" }, settle: 1_000, timeout: 10_000 },
    // The notice, and the TUI row: `parity.energy` active in TS, `./energy` skipped with its error to view in Rust.
    { checkpoint: "plugins", deviation: { file: "F16-typescript-plugins-skipped", lines: 10 } },
  ],
  masks: [{ pattern: /Ask anything… .*$/, reason: "the placeholder example: random in TS and Rust" }],
  osc: [],
})
