// A Luau plugin under a real terminal: the quick start in Luau on the Rust side
// (`crates/plugin/examples/luau/hello`; Luau plugins are on by default) against its TypeScript twin
// (`parity/plugins/luau-hello/tui.tsx`), in one `plugins` directory: its line closes the home footer, and `/hello` shows
// its toast. The suite's `*.pty.ts` glob still leaves this file out, from when a default build had no Luau; run it by
// path:
//   bun run parity:pty parity/scenarios/P.luau/hello.luau-pty.ts
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
  env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ debug: { devtools: false } }) },
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
    // Ctrl+C on the empty prompt exits; a second press could land once the terminal is restored, as a SIGINT.
    { keys: "\x03", until: { exit: true } },
  ],
  masks: [{ pattern: /Ask anything… .*$/, reason: "the placeholder is picked at random" }],
  exits: true,
})
