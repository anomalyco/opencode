export * as DesktopStorage from "./index"

import { app, BrowserWindow } from "electron"
import { Context, Effect, Layer, Path } from "effect"
import { openDatabase } from "./database"
import { createDraftStore } from "./drafts"
import { importLegacyStores } from "./legacy"
import { createStateStore } from "./state"

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
    yield* importLegacyStores(storage.db, userData).pipe(
      Effect.tap((result) =>
        result.removed.length === 0
          ? Effect.void
          : Effect.logInfo("imported legacy store files", { imported: result.imported, files: result.removed }),
      ),
      Effect.catch((error) => Effect.logWarning("failed to import legacy store files", { error })),
    )
    const wire = (_event: Electron.Event, win: BrowserWindow) => win.on("session-end", storage.flush)
    app.on("before-quit", storage.flush)
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire({} as Electron.Event, win))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("before-quit", storage.flush)
        app.off("browser-window-created", wire)
        BrowserWindow.getAllWindows().forEach((win) => win.off("session-end", storage.flush))
        storage.close()
      }),
    )
    return Service.of(storage)
  }),
)

// The file keeps its historical name; renaming it would mean moving the drafts it already holds.
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
