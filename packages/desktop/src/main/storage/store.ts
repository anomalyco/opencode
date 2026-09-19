import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import electron from "electron"

import { SETTINGS_STORE } from "./keys"
import { isStoreName } from "./name"

const cache = new Map<string, SettingsStore>()

export type SettingsStore = ReturnType<typeof createSettingsStore>

// Main-process settings only (onboarding, default server, window list, appearance, updater).
// These are read synchronously before the storage layer exists and written on user action, so a
// synchronous whole-file write is acceptable here. Renderer state goes through DesktopStorage.
//
// The file is the tab-indented JSON object electron-store used to write, so existing profiles
// (and older builds) read the same data.
//
// We cannot instantiate the store at module load time because module import hoisting causes this
// to run before app.setPath("userData", ...) has executed, which would result in files being
// written to the default directory (e.g. bad: %APPDATA%\@opencode\desktop\opencode.settings vs
// good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  if (!isStoreName(name)) throw new Error("Invalid store name")
  const cached = cache.get(name)
  if (cached) return cached
  const next = createSettingsStore(path.join(electron.app.getPath("userData"), name))
  cache.set(name, next)
  return next
}

export function createSettingsStore(file: string) {
  let data = read(file)
  const write = () => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, "\t"))
    renameSync(`${file}.tmp`, file)
  }
  return {
    path: file,
    get: (key: string): unknown => data[key],
    set: (key: string, value: unknown) => {
      if (value === undefined) throw new TypeError(`Use \`delete()\` to clear values: ${key}`)
      data = { ...data, [key]: value }
      write()
    },
    delete: (key: string) => {
      data = Object.fromEntries(Object.entries(data).filter(([item]) => item !== key))
      write()
    },
  }
}

// A missing file is an empty store. An unreadable one is set aside instead of blocking startup.
function read(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    renameSync(file, `${file}.corrupt`)
    return {}
  }
}
