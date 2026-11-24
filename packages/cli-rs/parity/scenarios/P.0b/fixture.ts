// The P-PTY fixture of P0b's plugin verbs that need a real terminal: one directory under the sandbox's global
// `plugins` directory holds the TS plugin (`parity/plugins/title/tui.ts`) and its opencode-native twin, a Luau plugin
// (`plugin.toml` and `init.luau`). TS loads the first, Rust the second; each client ignores the other's files.
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { PtyStep } from "../../pty/run"
import { parityRoot } from "../../cli/client"

// Installs the plugin, and writes `cli.json` when `config` is given.
export async function install(root: string, config?: object) {
  const directory = path.join(root, "home/.config/opencode/plugins/title")
  await mkdir(directory, { recursive: true })
  for (const file of ["tui.ts", "plugin.toml", "init.luau"]) {
    await copyFile(path.join(parityRoot, "plugins/title", file), path.join(directory, file))
  }
  const configured = { ...config, plugins: ["./plugins/title"] }
  await writeFile(path.join(root, "home/.config/opencode/cli.json"), JSON.stringify(configured))
}

// The home screen, once the Rust plugin's commands are listed.
export const home: PtyStep[] = [
  { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
  { keys: "/p0brun", until: { screen: "Run a program" }, settle: 200, timeout: 30_000 },
  { keys: "\x1b", until: { gone: "Run a program" }, settle: 200 },
  { keys: "\x15", until: { gone: "/p0brun" }, settle: 200 },
]

// Runs `command` through `/p0brun`, which first prints `ready-<n + 1>`, and waits for that: text the command itself
// does not contain, so the composer that shows the command does not match.
export function run(command: string, n: number): PtyStep[] {
  return [
    { keys: `/p0brun echo ready-$((${n}+1)); ${command}`, settle: 300 },
    { keys: "\r", until: { screen: `ready-${n + 1}` }, timeout: 15_000 },
  ]
}

// Ctrl+C on the empty prompt: the TUI exits. A second press could land once the terminal is restored, as a SIGINT.
export const leave: PtyStep[] = [{ keys: "\x03", until: { exit: true } }]
