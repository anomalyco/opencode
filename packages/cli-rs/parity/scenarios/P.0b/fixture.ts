// The P-PTY fixture of P0b's plugin verbs that need a real terminal: one directory under the sandbox's global
// `plugins` directory holds the TS plugin (`parity/plugins/title/tui.ts`) and its Rust twin, the sample plugin built
// with the `pty` feature, as `plugin.so`. TS loads the first, Rust the second; each client ignores the other's file.
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { PtyStep } from "../../pty/run"
import { parityRoot } from "../../cli/client"

const rs = path.resolve(parityRoot, "..")
const library = { linux: "libopencode_sample_plugin.so", darwin: "libopencode_sample_plugin.dylib" }
const entry = { linux: "plugin.so", darwin: "plugin.dylib" }

// Installs the plugin, and writes `cli.json` when `config` is given.
export async function install(root: string, config?: object) {
  const target = path.join(rs, "target/sample-plugin")
  const built = Bun.spawnSync(
    [
      "cargo",
      "build",
      "--quiet",
      "--manifest-path",
      path.join(rs, "crates/plugin/examples/sample/Cargo.toml"),
      "--target-dir",
      target,
      "--features",
      "pty",
    ],
    { cwd: rs, stdout: "inherit", stderr: "inherit" },
  )
  if (built.exitCode !== 0) throw new Error("the sample plugin did not build")
  const platform = process.platform === "darwin" ? "darwin" : "linux"
  const directory = path.join(root, "home/.config/opencode/plugins/title")
  await mkdir(directory, { recursive: true })
  await copyFile(path.join(target, "debug", library[platform]), path.join(directory, entry[platform]))
  await copyFile(path.join(parityRoot, "plugins/title/tui.ts"), path.join(directory, "tui.ts"))
  const configured = { ...config, plugins: ["./plugins/title"] }
  await writeFile(path.join(root, "home/.config/opencode/cli.json"), JSON.stringify(configured))
}

// The home screen, once the Rust plugin's commands are listed.
export const home: PtyStep[] = [
  { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
  { keys: "/p0brun", until: { screen: "Run a program" }, settle: 200, timeout: 30_000 },
  { keys: "\x1b", settle: 200 },
  { keys: "\x15", settle: 200 },
]

// Runs `command` through `/p0brun`, which first prints `ready-<n + 1>`, and waits for that: text the command itself
// does not contain, so the composer that shows the command does not match.
export function run(command: string, n: number): PtyStep[] {
  return [
    { keys: `/p0brun echo ready-$((${n}+1)); ${command}`, settle: 300 },
    { keys: "\r", until: { screen: `ready-${n + 1}` }, timeout: 15_000 },
  ]
}

// Two Ctrl+C: the TUI exits.
export const leave: PtyStep[] = [{ keys: "\x03", settle: 300 }, { keys: "\x03" }]

// Home, then `/p0btitle` once both clients list it, then two Ctrl+C to exit.
export const steps: PtyStep[] = [
  // The title can come before the first paint, so wait for the logo as well.
  { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
  { keys: "/p0btitle", until: { screen: "Set the title" }, settle: 300, timeout: 30_000 },
  { keys: "\r", until: { osc: "p0b title" }, settle: 300 },
  { keys: "\x03", settle: 300 },
  { keys: "\x03" },
]
