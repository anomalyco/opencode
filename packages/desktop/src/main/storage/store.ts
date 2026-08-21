import Store from "electron-store"
import electron from "electron"
import { Effect } from "effect"

import { deleteStoreFileIfEmpty } from "./cleanup"
import { SETTINGS_STORE } from "./keys"

const cache = new Map<string, Store>()

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

export const removeStoreFileIfEmpty = Effect.fn("DesktopStorage.removeStoreFileIfEmpty")(function* (name: string) {
  if (yield* deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
})

export function forgetStore(name: string) {
  cache.delete(name)
}
