// `restart` under `plugin dev` (PL-1, review carbon-1): `opencode-native plugin dev <crate>` builds the fault plugin
// and runs it under the crash parent, so the plugin loads; after a segfault in a render the parent starts
// `plugin dev <crate>` again, which builds and watches it again, and holds the build that crashed. Rust only: see
// `fault.ts`.
import os from "node:os"
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { definePty } from "../../pty/run"
import { palette, rust, server } from "./fault"

const rs = path.resolve(import.meta.dir, "../../..")
const example = path.join(rs, "crates/plugin/examples/fault")

// A copy of the fault crate in the working directory, its SDK named by absolute path.
async function setup(root: string) {
  const crate = path.join(root, "work/fault")
  await mkdir(path.join(crate, "src"), { recursive: true })
  const manifest = await readFile(path.join(example, "Cargo.toml"), "utf8")
  await writeFile(
    path.join(crate, "Cargo.toml"),
    manifest.replace('path = "../../../plugin-abi"', `path = ${JSON.stringify(path.join(rs, "crates/plugin-abi"))}`),
  )
  await writeFile(path.join(crate, "src/lib.rs"), await readFile(path.join(example, "src/lib.rs")))
}

export default definePty({
  args: [],
  command: rust(["plugin", "dev", "fault", "-s", "ses_b"]),
  // The sandbox's home has no toolchain: cargo builds offline from the user's, into a target of the repository's.
  env: {
    CARGO_HOME: process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(os.homedir(), ".rustup"),
    CARGO_TARGET_DIR: path.join(rs, "target/sample-plugin-dev"),
    CARGO_NET_OFFLINE: "true",
  },
  cols: 100,
  rows: 30,
  server,
  setup,
  steps: [
    // Without a parent the build is held as unsupervised, and its footer line never shows.
    { until: { screen: "fault plugin" }, settle: 500, timeout: 120_000, checkpoint: "loaded" },
    ...palette("Fault in render: segv"),
    {
      until: { screen: /^(?![\s\S]*fault plugin)(?=[\s\S]*Fix the parser)[\s\S]*crashed the client in `render-slot`/ },
      settle: 500,
      checkpoint: "restarted",
      timeout: 60_000,
    },
  ],
  osc: [],
})
