import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const root = fileURLToPath(new URL("..", import.meta.url))
const file = process.argv[2]
if (!file) throw new Error("A terminal tray connection file is required")
process.env.OPENCODE_CHANNEL = "local"

const install = Bun.spawn([process.execPath, "run", "install-electron"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if (await install.exited) throw new Error("Could not prepare Electron")

const { loadConfigFromFile, MainConfigFactory } = await import("electron-vite")
const { build } = await import("vite")
const result = await loadConfigFromFile(
  { command: "build", mode: "development" },
  join(root, "electron.vite.config.ts"),
)
if (!result.config.main) throw new Error("Missing Electron main configuration")
const config = await new MainConfigFactory(
  result.config.main,
  { configFile: false, mode: "development" },
  { root },
).build()
config.build = {
  ...config.build,
  outDir: join(root, "out/terminal-tray"),
  emptyOutDir: false,
  rolldownOptions: {
    ...config.build?.rolldownOptions,
    input: { index: join(root, "src/main/terminal-tray-entry.ts") },
  },
}
await build(config)
const { default: electron } = await import("electron")
const child = spawn(electron, [join(root, "out/terminal-tray/index.js"), `--terminal-tray=${file}`], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
})
await new Promise<void>((resolve, reject) => {
  child.once("spawn", resolve)
  child.once("error", reject)
})
child.unref()
