import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import electron from "electron"

import { SETTINGS_STORE } from "./keys"

const cache = new Map<string, SettingsStore>()

export type SettingsStore = ReturnType<typeof createSettingsStore>

// SAFETY: settings belong to independent owners; each owner decodes its value when reading it.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
type SettingsValues = Record<string, unknown>

// SAFETY: a read preserves the generic store until each setting's owner decodes it.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
type SettingsRead = { data: SettingsValues; error?: string }

// Main-process settings only (onboarding, default server, window list, appearance, extension storage).
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
  const cached = cache.get(name)

  if (cached) return cached
  const next = createSettingsStore(path.join(electron.app.getPath("userData"), name))
  cache.set(name, next)

  return next
}

export function createSettingsStore(file: string) {
  const loaded = read(file)
  let data = loaded.data

  const write = () => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, "\t"))
    renameSync(`${file}.tmp`, file)
  }

  return {
    path: file,
    readError: loaded.error,
    // SAFETY: callers decode their own settings schema at this persistence boundary.
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- see SAFETY above
    get: (key: string): unknown => data[key],
    // SAFETY: this generic store preserves each owner's independently validated value.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
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
function read(file: string): SettingsRead {
  if (!existsSync(file)) return { data: {} }

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))

    // SAFETY: JSON.parse returned an object; exclude arrays and null before treating it as a key/value store.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // SAFETY: the guard above established a JSON object; values are decoded by their owners.
      return { data: parsed as SettingsValues }
    }

    return { data: {}, error: "opencode.settings: expected a JSON object" }
  } catch {
    // An unreadable settings file may also be impossible to rename.
    try {
      renameSync(file, `${file}.corrupt`)
    } catch {}

    return { data: {}, error: "opencode.settings: invalid JSON or unreadable file" }
  }
}
