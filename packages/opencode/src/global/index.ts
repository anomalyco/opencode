import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Log } from "../util/log"

// CodeSurf Migration: Dynamic app name based on CODESURF_FOLDER env var

// - If CODESURF_FOLDER=".opencode" → Use "opencode" (compatibility mode, shared sessions)
// - Otherwise → Use "codesurf" (default, independent installation)
const appFolder = process.env["CODESURF_FOLDER"] || ".codesurf"
const isCompatibilityMode = appFolder === ".opencode"
const app = isCompatibilityMode ? "opencode" : "codesurf"
const legacyApp = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

// Legacy paths for migration (OpenCode paths)
const legacyData = path.join(xdgData!, legacyApp)
const legacyCache = path.join(xdgCache!, legacyApp)
const legacyConfig = path.join(xdgConfig!, legacyApp)
const legacyState = path.join(xdgState!, legacyApp)

export namespace Global {
  export const Path = {
    home: os.homedir(),
    data,
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
    // Legacy paths for fallback
    legacyData,
    legacyConfig,
    legacyState,
  } as const
}

// Create opencode directories
await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

// Migration function (kept for potential future use)
async function migrateFromLegacy() {
  try {
    // Check if legacy config exists and new one doesn't have content
    const legacyConfigExists = await fs
      .access(legacyConfig)
      .then(() => true)
      .catch(() => false)
    if (!legacyConfigExists) return

    const newConfigFiles = await fs.readdir(Global.Path.config).catch(() => [])
    const hasContent = newConfigFiles.length > 1 // More than just version file

    if (hasContent) {
      // Already migrated or has new content
      return
    }

    // Migration logic removed - app name is now consistently "opencode"
    // Note: Logging removed to avoid circular dependency
  } catch (error) {
    // Note: Logging removed to avoid circular dependency
  }
}

// Not calling migration since we're using the same name
// await migrateFromLegacy()

const CACHE_VERSION = "9"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
