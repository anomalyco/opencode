import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import { BunProc } from "../../bun"
import { Filesystem } from "../../util/filesystem"
import { fileURLToPath } from "url"

async function resolvePluginPath(entry: string): Promise<string> {
  if (entry.startsWith("file://")) {
    return fileURLToPath(entry)
  }
  const lastAt = entry.lastIndexOf("@")
  const pkg = lastAt > 0 ? entry.substring(0, lastAt) : entry
  const version = lastAt > 0 ? entry.substring(lastAt + 1) : "latest"
  return BunProc.install(pkg, version)
}

async function resolveCodexLoginBin(): Promise<string | null> {
  const config = await Config.get()
  const plugins = config.plugin ?? []
  const match = plugins.find((item) => item.includes("opencode-codex-auth-plugin"))
  if (!match) return null

  const root = await resolvePluginPath(match)
  const candidates = [
    path.join(root, "bin", "opencode-codex-login.js"),
    path.join(root, "dist", "bin.js"),
  ]

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) return candidate
  }
  return null
}

const CodexLoginCommand = cmd({
  command: "login",
  describe: "log in to Codex multi-account",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const bin = await resolveCodexLoginBin()
        if (!bin) {
          UI.error("opencode-codex-auth-plugin not found in config. Add it to opencode.json first.")
          process.exitCode = 1
          return
        }
        const proc = Bun.spawn({
          cmd: [process.execPath, bin],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "inherit",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          UI.error("Codex login failed")
          process.exitCode = 1
        }
      },
    })
  },
})

export const CodexCommand = cmd({
  command: "codex",
  describe: "codex auth utilities",
  builder: (yargs) => yargs.command(CodexLoginCommand).demandCommand(),
  async handler() {},
})
