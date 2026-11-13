// The fault plugin of `crates/plugin/examples/fault`, built and installed in a sandbox's global `plugins` directory,
// and the session the restart scenarios open. The TS client has no native plugins, so these scenarios run the Rust
// client on both sides: they pin what the user sees through a crash and a restart, and that it repeats.
import path from "node:path"
import { mkdir, copyFile } from "node:fs/promises"
import { command, withServer, type Side } from "../../cli/client"

const rs = path.resolve(import.meta.dir, "../../..")
const target = path.join(rs, "target/sample-plugin")

export async function install(root: string) {
  const build = Bun.spawn(
    [
      "cargo",
      "build",
      "--quiet",
      "--offline",
      "--manifest-path",
      path.join(rs, "crates/plugin/examples/fault/Cargo.toml"),
      "--target-dir",
      target,
    ],
    { cwd: rs, stdout: "inherit", stderr: "inherit" },
  )
  if ((await build.exited) !== 0) throw new Error("the fault plugin did not build")
  const dir = path.join(root, "home/.config/opencode/plugins/fault")
  await mkdir(dir, { recursive: true })
  await copyFile(path.join(target, "debug/libopencode_fault.so"), path.join(dir, "plugin.so"))
}

export const session = {
  id: "ses_b",
  title: "Fix the parser",
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/tmp/opencode/packages/tui" },
}

export const server = {
  fallback: "tui" as const,
  routes: [
    { path: "/api/session/ses_b", json: { data: session } },
    { path: "/api/session/ses_b/message", json: { data: [], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
}

// Both sides run `opencode-native`, with no core file: a run of the suite leaves nothing in `coredumpctl` to keep.
export const rust = (args: string[]) => (_side: Side, url: string | undefined) => [
  "sh",
  "-c",
  'ulimit -c 0; exec "$@"',
  "sh",
  ...command("rs", withServer(args, url)),
]

// Runs a palette command by its title.
export const palette = (title: string) => [
  { keys: "\x10", until: { screen: "Search commands" }, settle: 300 },
  { keys: title, until: { screen: title }, settle: 300 },
  { keys: "\r" },
]
