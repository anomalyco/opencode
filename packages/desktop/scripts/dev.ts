import { $ } from "bun"
import { join } from "node:path"
import { downloadCliToResources, windowsify } from "./utils"

type ServerSource = { type: "build" } | { type: "download"; version: string }
type DevOptions = { server: ServerSource; electron: string[] }

async function main() {
  process.env.OPENCODE_CHANNEL = "local"
  process.env.OPENCODE_VERSION = `2.0.0-local-${Date.now()}`
  process.env.OPENCODE_DISABLE_CHANNEL_DB = "0"
  const options = selectOptions()
  if (options.server.type === "build") process.env.OPENCODE_DESKTOP_SERVER_CHANNEL = "local"
  process.env.OPENCODE_DESKTOP_ISOLATED_SERVER = "1"
  await prepareDesktop()
  await prepareServer(options.server)
  await startDesktop(options.electron)
}

async function prepareDesktop() {
  await Promise.all([
    $`bun run install-electron`,
    $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`,
  ])
}

function selectOptions(): DevOptions {
  const args = process.argv.slice(2)
  const build = args.indexOf("--build-server")
  const download = args.indexOf("--download-server")
  if (build >= 0 && download >= 0) {
    throw new Error("--build-server and --download-server cannot be used together")
  }
  if (download >= 0 && !args[download + 1]) throw new Error("--download-server requires a version")
  const consumed = new Set([build, download, download >= 0 ? download + 1 : -1])
  return {
    server: download >= 0 ? { type: "download", version: args[download + 1] } : { type: "build" },
    electron: args.filter((_, index) => !consumed.has(index)),
  }
}

async function prepareServer(source: ServerSource) {
  if (source.type === "download")
    return downloadCliToResources(source.version, windowsify("resources/opencode-cli-dev"))
  process.env.OPENCODE_DESKTOP_CLI_DEV = join(import.meta.dirname, "../../cli")
  if (process.platform !== "win32") return
  process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD = join(import.meta.dirname, "../../cli/script/build.ts")
  process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT = join(import.meta.dirname, "../resources/opencode-cli-wsl")
}

async function startDesktop(args: string[]) {
  await $`electron-vite dev ${args}`
}

await main()
