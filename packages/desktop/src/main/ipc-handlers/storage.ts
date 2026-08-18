import { Effect } from "effect"
import { StorageRpcs } from "../../shared/ipc-rpc"
import type { createDesktopStorage } from "../storage"

export function storageHandlers(storage: ReturnType<typeof createDesktopStorage>) {
  return StorageRpcs.toLayer(
    Effect.succeed(
      StorageRpcs.of({
        StorageGet: ({ name, key }) => Effect.sync(() => storage.get(name, key)),
        StorageSet: ({ name, key, value }) => Effect.sync(() => storage.set(name, key, value)),
        StorageDelete: ({ name, key }) => Effect.sync(() => storage.deleteValue(name, key)),
        StorageClear: ({ name }) => Effect.sync(() => storage.clear(name)),
        StorageKeys: ({ name }) => Effect.sync(() => storage.keys(name)),
        StorageLength: ({ name }) => Effect.sync(() => storage.length(name)),
        DraftsGet: ({ key }) => Effect.sync(() => storage.drafts.get(key)),
        DraftsSet: ({ key, value }) => Effect.sync(() => storage.drafts.set(key, value)),
        DraftsDelete: ({ key }) => Effect.sync(() => storage.drafts.set(key, null)),
        DraftsPutBlob: ({ data }) =>
          Effect.sync(() =>
            storage.drafts.putBlob(
              data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
            ),
          ),
        DraftsGetBlob: ({ id }) =>
          Effect.sync(() => {
            const data = storage.drafts.getBlob(id)
            return data ? new Uint8Array(data) : null
          }),
      }),
    ),
  )
}
