import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { write as writeLog } from "./logging"

const PORTABLE_DIR_NAME = "opencode-data"
const PORTABLE_MARKER = ".portable"

export type PortablePaths = {
  root: string
  config: string
  data: string
  state: string
  cache: string
  desktop: string
}

export function defaultPortableRoot(): string {

  if (!app.isPackaged) {
    return join(app.getAppPath(), PORTABLE_DIR_NAME)
  }
  return join(dirname(app.getPath("exe")), PORTABLE_DIR_NAME)
}

function portableRoot(): string | null {
  const root = defaultPortableRoot()

  if (!existsSync(root)) return null
  if (!existsSync(join(root, PORTABLE_MARKER))) return null
  return root
}

export function detectPortableMode(): PortablePaths | null {
  const root = portableRoot()
  if (!root) return null
  return {
    root,
    config: join(root, "config", "opencode"),
    data: join(root, "data", "opencode"),
    state: join(root, "state", "opencode"),
    cache: join(root, "cache", "opencode"),
    desktop: join(root, "desktop"),
  }
}

export function ensurePortableStructure(root: string): void {
  const dirs = [
    join(root, "config", "opencode"),
    join(root, "data", "opencode"),
    join(root, "state", "opencode"),
    join(root, "cache", "opencode"),
    join(root, "desktop"),
  ]
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch (error) {
      // Ignore if exists
    }
  }
}

export function applyPortableEnv(paths: PortablePaths): void {
  const vars = {
    OPENCODE_CONFIG_DIR: paths.config,
    XDG_DATA_HOME: join(paths.root, "data"),
    XDG_STATE_HOME: paths.state,
    XDG_CACHE_HOME: paths.cache,
  }
  for (const [key, value] of Object.entries(vars)) {

    process.env[key] = value
  }
}

export function createPortableDir(root: string): void {
  try {
    mkdirSync(join(root, "config", "opencode"), { recursive: true })
    mkdirSync(join(root, "data", "opencode"), { recursive: true })
    mkdirSync(join(root, "state", "opencode"), { recursive: true })
    mkdirSync(join(root, "cache", "opencode"), { recursive: true })
    mkdirSync(join(root, "desktop"), { recursive: true })
    writeFileSync(join(root, PORTABLE_MARKER), "")
  } catch (error) {
    writeLog("portable", "Failed to create portable directory", { error }, "error")
    throw error
  }
}

export function disablePortableMarker(root: string): void {
  try {
    rmSync(join(root, PORTABLE_MARKER), { force: true })
  } catch (error) {
    writeLog("portable", "Failed to disable portable marker", { error }, "error")
    throw error
  }
}
