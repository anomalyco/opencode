import { app } from "electron"
import log from "electron-log/main.js"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { CHANNEL } from "./constants"
import { getStore } from "./store"

const TAURI_MIGRATED_KEY = "tauriMigrated"

// Resolve the directory where Tauri stored its .dat files for the given app identifier.
function tauriDir(id: string) {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id)
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
  }
}

// Support old OpenCode, OpenKimi, and new Cedric identifiers
const TAURI_APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

const OPENKIMI_APP_IDS: Record<string, string> = {
  dev: "dev.openkimi.desktop.dev",
  beta: "dev.openkimi.desktop.beta",
  prod: "dev.openkimi.desktop",
}

const CEDRIC_APP_IDS: Record<string, string> = {
  dev: "dev.cedric.desktop.dev",
  beta: "dev.cedric.desktop.beta",
  prod: "dev.cedric.desktop",
}

function tauriAppId() {
  return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
}

function migrateFile(datPath: string, filename: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(datPath, "utf-8"))
  } catch (err) {
    log.warn("migration: failed to parse", filename, err)
    return
  }

  const storeName = filename === "opencode.settings.dat" ? "openkimi.settings" : filename
  const target = getStore(storeName)
  const migrated: string[] = []
  const skipped: string[] = []

  for (const [key, value] of Object.entries(data)) {
    if (target.has(key)) {
      skipped.push(key)
      continue
    }
    target.set(key, value)
    migrated.push(key)
  }

  log.log("migration: migrated", filename, "→", storeName, { migrated, skipped })
}

export function migrate() {
  if (getStore().get(TAURI_MIGRATED_KEY)) {
    log.log("migration: already done, skipping")
    return
  }

  // Try OpenCode directory first
  const opencodeDir = tauriDir(tauriAppId())
  const openkimiDir = tauriDir(OPENKIMI_APP_IDS[CHANNEL] || OPENKIMI_APP_IDS.dev)

  let dir = opencodeDir

  if (!existsSync(dir)) {
    // Try OpenKimi directory
    dir = openkimiDir
    if (!existsSync(dir)) {
      log.log("migration: no data directory found, nothing to migrate")
      getStore().set(TAURI_MIGRATED_KEY, true)
      return
    }
  }

  log.log("migration: starting", { dir })

  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith(".dat")) continue
    migrateFile(join(dir, filename), filename)
  }

  log.log("migration: complete")
  getStore().set(TAURI_MIGRATED_KEY, true)
}
