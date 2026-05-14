import { app } from "electron"
import log from "electron-log/main.js"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { CHANNEL } from "./constants"
import { getStore } from "./store"

// v2: fixes workspace store name remapping (base64 → pathKey+checksum)
const TAURI_MIGRATED_KEY = "tauriMigrated2"

// Resolve the directory where Tauri stored its .dat files for the given app identifier.
// Mirrors Tauri's AppLocalData / AppData resolution per OS.
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

// The Tauri app identifier changes between dev/beta/prod builds.
const TAURI_APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
function tauriAppId() {
  return app.isPackaged ? TAURI_APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
}

// Decode a URL-safe base64 string (Tauri's old workspace filename encoding).
function base64Decode(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Normalize a filesystem path to a canonical key (forward slashes, no trailing slash).
function pathKey(path: string) {
  const value = path.replaceAll("\\", "/")
  const trimmed = value.replace(/\/+$/, "")
  // Bare drive letter like "C:" → "C:/"
  if (trimmed.length === 2 && trimmed[1] === ":") return trimmed + "/"
  return trimmed
}

// FNV-1a 32-bit checksum (matches packages/core/src/util/encode.ts).
function checksum(content: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

// Derive the electron-store name for a workspace path (matches persist.ts:workspaceStorage).
function workspaceStoreName(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.workspace.${head}.${checksum(dir)}.dat`
}

// Migrate a single Tauri .dat file into the corresponding electron-store.
// `opencode.settings.dat` is special: it maps to the `opencode.settings` store
// (the electron-store name without the `.dat` extension). All other .dat files
// keep their full filename as the electron-store name so they match what the
// renderer already passes via IPC (e.g. `"default.dat"`, `"opencode.global.dat"`).
function migrateFile(datPath: string, filename: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(readFileSync(datPath, "utf-8"))
  } catch (err) {
    log.warn("tauri migration: failed to parse", filename, err)
    return
  }

  // opencode.settings.dat → the electron settings store ("opencode.settings").
  // Workspace .dat files from old Tauri builds use base64-encoded paths as the
  // filename segment (e.g. "Qzpc" = base64("C:\")). Decode and remap to the
  // current workspaceStorage naming scheme so session data lands in the right store.
  let storeName = filename === "opencode.settings.dat" ? "opencode.settings" : filename
  const workspaceMatch = filename.match(/^opencode\.workspace\.([^.]+)\.[^.]+\.dat$/)
  if (workspaceMatch) {
    try {
      const decoded = base64Decode(workspaceMatch[1])
      const key = pathKey(decoded)
      const remapped = workspaceStoreName(key)
      if (remapped !== filename) {
        log.log("tauri migration: remapping workspace store", filename, "→", remapped)
        storeName = remapped
      }
    } catch {
      // not a base64-encoded name (already new format), keep original
    }
  }
  const target = getStore(storeName)
  const migrated: string[] = []
  const skipped: string[] = []

  for (const [key, value] of Object.entries(data)) {
    // Don't overwrite values the user has already set in the Electron app.
    if (target.has(key)) {
      skipped.push(key)
      continue
    }
    target.set(key, value)
    migrated.push(key)
  }

  log.log("tauri migration: migrated", filename, "→", storeName, { migrated, skipped })
}

export function migrate() {
  if (getStore().get(TAURI_MIGRATED_KEY)) {
    log.log("tauri migration: already done, skipping")
    return
  }

  const dir = tauriDir(tauriAppId())
  log.log("tauri migration: starting", { dir })

  if (!existsSync(dir)) {
    log.log("tauri migration: no tauri data directory found, nothing to migrate")
    getStore().set(TAURI_MIGRATED_KEY, true)
    return
  }

  for (const filename of readdirSync(dir)) {
    if (!filename.endsWith(".dat")) continue
    migrateFile(join(dir, filename), filename)
  }

  log.log("tauri migration: complete")
  getStore().set(TAURI_MIGRATED_KEY, true)
}
