import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { decodeDesktopConfigJson } from "@opencode-ai/app/desktop-config"

type Logger = {
  log: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
}

function configDir() {
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "opencode")
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "opencode")
  return join(homedir(), ".config", "opencode")
}

function configPath() {
  return join(configDir(), "desktop.json")
}

export async function readDesktopConfig(logger?: Logger) {
  const path = configPath()
  logger?.log("desktop config: reading desktop.json", {
    path,
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    appData: process.env.APPDATA,
  })

  const text = await readFile(path, "utf8").catch((error) => {
    const data = { path, ...errorDetails(error) }
    if (isNotFound(error)) {
      logger?.log("desktop config: desktop.json not found", data)
      return
    }
    logger?.warn("desktop config: failed to read desktop.json", data)
  })
  if (text === undefined) return

  const config = decodeDesktopConfigJson(text)
  if (!config) {
    logger?.warn("desktop config: failed to parse or decode desktop.json", { path })
    return
  }
  logger?.log("desktop config: loaded desktop.json", { path, config })
  return config
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { error: String(error) }
  return {
    name: error.name,
    message: error.message,
    code: typeof error === "object" && "code" in error ? error.code : undefined,
  }
}
