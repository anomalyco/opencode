export * as DesktopStorage from "./index"

import { app, BrowserWindow } from "electron"
import { Context, Effect, Layer, Path } from "effect"
import { createDesktopDraftStore } from "./drafts"
import { getStore, removeStoreFileIfEmpty } from "./store"

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopStorage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const storage = make(path.join(app.getPath("userData"), "drafts.sqlite"))
    const flush = () => storage.drafts.flush()
    const wire = (_event: Electron.Event, win: BrowserWindow) => win.on("session-end", flush)
    app.on("before-quit", flush)
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire({} as Electron.Event, win))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("before-quit", flush)
        app.off("browser-window-created", wire)
        BrowserWindow.getAllWindows().forEach((win) => win.off("session-end", flush))
        storage.drafts.close()
      }),
    )
    return Service.of(storage)
  }),
)

function make(draftFile: string) {
  const drafts = createDesktopDraftStore(draftFile)
  const deleteValue = Effect.fn("DesktopStorage.delete")(function* (name: string, key: string) {
    getStore(name).delete(key)
    yield* removeStoreFileIfEmpty(name).pipe(Effect.ignore)
  })
  const clear = Effect.fn("DesktopStorage.clear")(function* (name: string) {
    getStore(name).clear()
    yield* removeStoreFileIfEmpty(name).pipe(Effect.ignore)
  })

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
    deleteValue,
    clear,
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
      flush: drafts.flush,
      close: drafts.close,
    },
  }
}
