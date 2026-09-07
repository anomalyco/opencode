import Store from "electron-store"
import electron from "electron"

import { SETTINGS_STORE } from "./keys"

const cache = new Map<string, Store>()

// Main-process settings only (onboarding, default server, window list, appearance, updater).
// These are read synchronously before the storage layer exists and written on user action, so
// electron-store's synchronous file write is acceptable here. Renderer state goes through
// DesktopStorage instead.
//
// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,
    cwd: electron.app.getPath("userData"),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}
