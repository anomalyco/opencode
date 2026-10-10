export * as DesktopStorage from "./index"

import { app, BrowserWindow } from "electron"
import { Context, Effect, Layer, Path } from "effect"
import { marks } from "../lifecycle/marks"
import { openDatabase } from "./database"
import { setStorageSnapshotProvider } from "./snapshot"
import { createDraftStore } from "./drafts"
import { importLegacyStores } from "./legacy"
import { createStateStore } from "./state"
import { readEnableState } from "../extension/enable-state"

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopStorage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const runFork = Effect.runForkWith(yield* Effect.context())
    const userData = app.getPath("userData")

    const storage = make(path.join(userData, "drafts.sqlite"), (error) =>
      runFork(Effect.logError("storage flush failed", { error })),
    )

    // The import is a one-time migration of files the renderer no longer writes. The renderer's
    // first request arrives over the IPC port, which is handed out after the layers, so the import
    // runs in the background instead of holding the layers (and the port) back.
    yield* importLegacyStores(storage.db, userData).pipe(
      Effect.tap((result) =>
        result.removed.length === 0
          ? Effect.void
          : Effect.logInfo("imported legacy store files", { imported: result.imported, files: result.removed }),
      ),
      Effect.catch((error) => Effect.logWarning("failed to import legacy store files", { error })),
      Effect.forkScoped,
    )
    const wire = (_event: Electron.Event | undefined, win: BrowserWindow) => win.on("session-end", storage.flush)
    app.on("before-quit", storage.flush)
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire(undefined, win))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("before-quit", storage.flush)
        app.off("browser-window-created", wire)
        BrowserWindow.getAllWindows().forEach((win) => win.off("session-end", storage.flush))
        storage.close()
      }),
    )
    setStorageSnapshotProvider((names) => ({
      storage: Object.fromEntries(names.map((name) => [name, storage.state.items(name)])),
      extensions: readEnableState(storage.db.$client),
    }))
    marks.storage = Date.now()

    return Service.of(storage)
  }),
)

// The file keeps its historical name; renaming it would mean moving the drafts it already holds.
// SAFETY: this observer only reports caught write failures; it never interprets them as stored values.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
export function make(filename: string, onError?: (error: unknown) => void) {
  const database = openDatabase(filename)
  const state = createStateStore(database.db, { onError })
  const drafts = createDraftStore(database.db, { onError })

  return {
    db: database.db,
    state,
    drafts,
    flush() {
      state.flush()
      drafts.flush()
    },
    close() {
      state.close()
      drafts.close()
      database.close()
    },
  }
}
