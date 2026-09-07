import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { StorageRpcs } from "../../shared/ipc-rpc"
import { StorageChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { DesktopStorage } from "../storage"
import { sender } from "./context"

export const storageHandlers = StorageRpcs.toLayer(
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service
    const handoff = yield* IpcPortHandoff
    return StorageRpcs.of({
      StorageItems: ({ name }) => Effect.sync(() => storage.state.items(name)),
      StorageUpdate: ({ name, insert, remove }, context) =>
        Effect.sync(() => {
          storage.state.update(name, insert, remove)
          // Other windows hold their own copy of this namespace; tell them what moved.
          const origin = sender(handoff, context)
          const event = new StorageChanged({ name, insert, remove })
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.webContents !== origin) emitIpcEvent(win.webContents, event)
          }
        }),
      StorageClear: ({ name }) => Effect.sync(() => storage.state.clear(name)),
      DraftsGet: ({ key }) => Effect.sync(() => storage.drafts.get(key)),
      DraftsSet: ({ key, value }) => Effect.sync(() => storage.drafts.set(key, value)),
      DraftsDelete: ({ key }) => Effect.sync(() => storage.drafts.set(key, null)),
      DraftsPutBlob: ({ data }) => Effect.sync(() => storage.drafts.putBlob(data)),
      DraftsGetBlob: ({ id }) => Effect.sync(() => storage.drafts.getBlob(id)),
    })
  }),
)
