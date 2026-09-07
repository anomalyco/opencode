import { Effect } from "effect"
import { StorageRpcs } from "../../shared/ipc-rpc"
import { DesktopStorage } from "../storage"

export const storageHandlers = StorageRpcs.toLayer(
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service
    return StorageRpcs.of({
      StorageGet: ({ name, key }) => Effect.sync(() => storage.state.get(name, key)),
      StorageSet: ({ name, key, value }) => Effect.sync(() => storage.state.set(name, key, value)),
      StorageDelete: ({ name, key }) => Effect.sync(() => storage.state.delete(name, key)),
      StorageClear: ({ name }) => Effect.sync(() => storage.state.clear(name)),
      StorageKeys: ({ name }) => Effect.sync(() => storage.state.keys(name)),
      StorageLength: ({ name }) => Effect.sync(() => storage.state.length(name)),
      DraftsGet: ({ key }) => Effect.sync(() => storage.drafts.get(key)),
      DraftsSet: ({ key, value }) => Effect.sync(() => storage.drafts.set(key, value)),
      DraftsDelete: ({ key }) => Effect.sync(() => storage.drafts.set(key, null)),
      DraftsPutBlob: ({ data }) => Effect.sync(() => storage.drafts.putBlob(data)),
      DraftsGetBlob: ({ id }) => Effect.sync(() => storage.drafts.getBlob(id)),
    })
  }),
)
