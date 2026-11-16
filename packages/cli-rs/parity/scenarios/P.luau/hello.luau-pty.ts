// A Luau plugin under a real terminal (spike `luau-spike`): the quick start in Luau on the Rust side
// (`crates/plugin/examples/luau/hello`, in a build with the `luau` feature and `OPENCODE_PLUGIN_LUAU=1`) against its
// TypeScript twin (`parity/plugins/luau-hello/tui.tsx`), in one `plugins` directory: its line closes the home footer,
// and `/hello` shows its toast. A default build has no Luau, so the suite's `*.pty.ts` glob leaves this file out; run
// it by path with OPENCODE_RS_BIN naming a build with the feature:
//   OPENCODE_RS_BIN=<opencode-native built with --features luau> bun run parity:pty parity/scenarios/P.luau/hello.luau-pty.ts
import { copyFile, mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { parityRoot } from "../../cli/client"
import { definePty } from "../../pty/run"

const example = path.resolve(parityRoot, "../crates/plugin/examples/luau/hello")

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  server: { fallback: "tui" },
  // The TS client run from source is on the `local` channel, which shows its devtools bar: off, as Rust has none.
  env: { OPENCODE_PLUGIN_LUAU: "1", OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ debug: { devtools: false } }) },
  setup: async (root) => {
    const directory = path.join(root, "home/.config/opencode/plugins/hello")
    await mkdir(directory, { recursive: true })
    for (const file of await readdir(example)) await copyFile(path.join(example, file), path.join(directory, file))
    await copyFile(path.join(parityRoot, "plugins/luau-hello/tui.tsx"), path.join(directory, "tui.tsx"))
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { until: { screen: /hello\s*$/m }, settle: 300, timeout: 30_000, checkpoint: "home" },
    { keys: "/hello", until: { screen: "Say hello" }, settle: 300 },
    { keys: "\r", until: { screen: "Hello from a plugin" }, settle: 300, checkpoint: "toast" },
    { keys: "\x03", settle: 300 },
    { keys: "\x03" },
  ],
  masks: [{ pattern: /Ask anything… .*$/, reason: "the placeholder is picked at random" }],
  exits: true,
})
