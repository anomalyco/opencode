// The fault plugin of `crates/plugin/examples/fault`, built and installed in a sandbox's global `plugins` directory,
// and the session the restart scenarios open. The TS client has no native plugins, so these scenarios run the Rust
// client on both sides: they pin what the user sees through a crash and a restart, and that it repeats.
import path from "node:path"
import { mkdir, copyFile } from "node:fs/promises"
import { command, withServer, type Side } from "../../cli/client"

const rs = path.resolve(import.meta.dir, "../../..")
const target = path.join(rs, "target/sample-plugin")

// Builds the plugin as `example.fault`, or with feature `b` or `c` as `example.fault.b` or `.c`, and installs it.
async function installBuild(root: string, feature: "" | "b" | "c") {
  const dir = feature ? `${target}-${feature}` : target
  const build = Bun.spawn(
    [
      "cargo",
      "build",
      "--quiet",
      "--offline",
      "--manifest-path",
      path.join(rs, "crates/plugin/examples/fault/Cargo.toml"),
      "--target-dir",
      dir,
      ...(feature ? ["--features", feature] : []),
    ],
    { cwd: rs, stdout: "inherit", stderr: "inherit" },
  )
  if ((await build.exited) !== 0) throw new Error("the fault plugin did not build")
  const plugin = path.join(root, `home/.config/opencode/plugins/fault${feature ? `-${feature}` : ""}`)
  await mkdir(plugin, { recursive: true })
  await copyFile(path.join(dir, "debug/libopencode_fault.so"), path.join(plugin, "plugin.so"))
}

export const install = (root: string) => installBuild(root, "")

// Three fault plugins, for three crashes by three different plugins.
export async function installThree(root: string) {
  for (const feature of ["", "b", "c"] as const) await installBuild(root, feature)
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

// A message of the transcript, which a restarted client shows again.
const message = { id: "msg_1", type: "user", text: "the transcript survives", time: { created: 1 } }

export const server = {
  fallback: "tui" as const,
  routes: [
    { path: "/api/session/ses_b", json: { data: session } },
    { path: "/api/session/ses_b/message", json: { data: [message], cursor: {} } },
    { path: "/api/session/ses_b/inbox", json: { data: [] } },
  ],
}

// The command line `bash -i` runs, quoted for it.
export const shellLine = (args: string[], url: string | undefined) =>
  command("rs", withServer(args, url))
    .map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`)
    .join(" ")

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
