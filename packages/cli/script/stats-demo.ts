import { mkdtemp, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
await mkdir(path.join(os.tmpdir(), "opencode"), { recursive: true })
const directory = await mkdtemp(path.join(os.tmpdir(), "opencode/stats-demo-"))
const project = path.join(directory, "project")
await mkdir(project, { recursive: true })
const env = {
  ...process.env,
  XDG_DATA_HOME: path.join(directory, "data"),
  XDG_CONFIG_HOME: path.join(directory, "config"),
  XDG_CACHE_HOME: path.join(directory, "cache"),
  XDG_STATE_HOME: path.join(directory, "state"),
  OPENCODE_TEST_HOME: directory,
  OPENCODE_CONFIG_DIR: path.join(directory, "config/opencode"),
  OPENCODE_CONFIG: path.join(project, "opencode.json"),
  OPENCODE_CONFIG_CONTENT: "{}",
  OPENCODE_DB: path.join(directory, "stats.db"),
  OPENCODE_TUI_CHANNEL: "stats-demo",
}
await Bun.write(path.join(project, "opencode.json"), "{}\n")
await Bun.write(
  path.join(env.OPENCODE_CONFIG_DIR, "cli.json"),
  JSON.stringify({
    debug: { devtools: false },
    theme: { name: "opencode", mode: process.argv.includes("--light") ? "light" : "dark" },
  }),
)
console.log(`Isolated stats demo: ${directory}`)
const seed = Bun.spawn(
  [process.execPath, path.join(root, "packages/core/script/seed-stats.ts"), env.OPENCODE_DB, project],
  {
    cwd: root,
    env,
    stdout: "inherit",
    stderr: "inherit",
  },
)
if ((await seed.exited) !== 0) process.exit(1)
console.log("Open /stats to see two years of usage. Press tab to show this year, or esc to go back.")
const child = Bun.spawn([process.execPath, "run", "--conditions=browser", "src/index.ts", "--standalone", project], {
  cwd: path.join(root, "packages/cli"),
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.on("SIGTERM", () => child.kill("SIGTERM"))
process.on("SIGINT", () => child.kill("SIGINT"))
process.exitCode = await child.exited
