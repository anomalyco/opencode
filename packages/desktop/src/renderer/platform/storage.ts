import { createDraftStore, type Platform } from "@opencode-ai/app/desktop"
import type { AsyncStorage } from "@solid-primitives/storage"
import type { ElectronAPI } from "../api-types"

export function createDesktopStorage(api: ElectronAPI) {
  const cache = new Map<string, AsyncStorage>()
  const storage: NonNullable<Platform["storage"]> = (name = "default.dat") => {
    const cached = cache.get(name)
    if (cached) return cached
    const next: AsyncStorage = {
      getItem: (key) => api.storeGet(name, key),
      setItem: (key, value) => api.storeSet(name, key, value),
      removeItem: (key) => api.storeDelete(name, key),
      clear: () => api.storeClear(name),
      key: async (index: number) => (await api.storeKeys(name))[index],
      getLength: () => api.storeLength(name),
      get length() {
        return next.getLength()
      },
    }
    cache.set(name, next)
    return next
  }

  return {
    storage,
    draftStore: createDraftStore({
      get: api.draftGet,
      set: api.draftSet,
      remove: api.draftDelete,
      putBlob: (blob) => blob.arrayBuffer().then(api.draftBlobPut),
      getBlob: (id) => api.draftBlobGet(id).then((data) => data && new Blob([data])),
    }),
  }
}
