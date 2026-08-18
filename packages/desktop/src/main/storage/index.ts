import { join } from "node:path"
import { app } from "electron"
import { createDesktopDraftStore } from "./drafts"
import { getStore, removeStoreFileIfEmpty } from "./store"

export function createDesktopStorage() {
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  return {
    get(name: string, key: string) {
      try {
        const value = getStore(name).get(key)
        if (value === undefined || value === null) return null
        return typeof value === "string" ? value : JSON.stringify(value)
      } catch {
        return null
      }
    },
    set: (name: string, key: string, value: string) => getStore(name).set(key, value),
    deleteValue(name: string, key: string) {
      getStore(name).delete(key)
      void removeStoreFileIfEmpty(name)
    },
    clear(name: string) {
      getStore(name).clear()
      void removeStoreFileIfEmpty(name)
    },
    keys: (name: string) => Object.keys(getStore(name).store),
    length: (name: string) => Object.keys(getStore(name).store).length,
    drafts: {
      get: (key: string) => drafts.get(key),
      set: (key: string, value: string | null) => drafts.set(key, value),
      putBlob: (data: ArrayBuffer) => drafts.putBlob(new Uint8Array(data)),
      getBlob(id: string) {
        const data = drafts.getBlob(id)
        return data ? new Uint8Array(data).buffer : null
      },
    },
  }
}
