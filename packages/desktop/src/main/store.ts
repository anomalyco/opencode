import Store from "electron-store"
import { app } from "electron"
import { dirname, join } from "node:path"

import { SETTINGS_STORE } from "./constants"

const cache = new Map<string, Store>()

function getPortableDataPath(): string {
  if (app.isPackaged) {
    const exePath = app.getPath("exe")
    const exeDir = dirname(exePath)
    return join(exeDir, "data")
  }
  return app.getPath("userData")
}

export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,
    cwd: getPortableDataPath(),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}
