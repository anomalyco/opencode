import { Effect } from "effect"
import { StorageRpcs } from "../../shared/ipc-rpc"
import { DesktopStorage } from "../storage"

export const storageHandlers = StorageRpcs.toLayer(
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service
    return StorageRpcs.of({
      StorageGet: ({ name, key }) => Effect.sync(() => storage.get(name, key)),
      StorageSet: ({ name, key, value }) => Effect.sync(() => storage.set(name, key, value)),
      StorageDelete: ({ name, key }) => storage.deleteValue(name, key).pipe(Effect.orDie),
      StorageClear: ({ name }) => storage.clear(name).pipe(Effect.orDie),
      StorageKeys: ({ name }) => Effect.sync(() => storage.keys(name)),
      StorageLength: ({ name }) => Effect.sync(() => storage.length(name)),
      DraftsGet: ({ key }) => Effect.sync(() => storage.drafts.get(key)),
      DraftsSet: ({ key, value }) => Effect.sync(() => storage.drafts.set(key, value)),
      DraftsDelete: ({ key }) => Effect.sync(() => storage.drafts.set(key, null)),
      DraftsPutBlob: ({ data }) =>
        Effect.sync(() =>
          storage.drafts.putBlob(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer),
        ),
      DraftsGetBlob: ({ id }) =>
        Effect.sync(() => {
          const data = storage.drafts.getBlob(id)
          return data ? new Uint8Array(data) : null
        }),
    })
  }),
)
