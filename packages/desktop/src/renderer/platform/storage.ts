import {
  createDraftStore,
  createNamespaceStorage,
  type NamespaceStorage,
  type Platform,
} from "@opencode-ai/app/desktop"
import type { ElectronAPI } from "../api-types"
import { onBeforeDispose } from "../ipc-client"

export function createDesktopStorage(api: ElectronAPI) {
  const namespaces = new Map<string, NamespaceStorage>()
  const driver = { items: api.storeItems, update: api.storeUpdate, clear: api.storeClear }
  const storage: NonNullable<Platform["storage"]> = (name = "default.dat") => {
    const cached = namespaces.get(name)
    if (cached) return cached
    const next = createNamespaceStorage(driver, name)
    namespaces.set(name, next)
    return next
  }
  const flush = () => Promise.all([...namespaces.values()].map((namespace) => namespace.flush()))

  api.onStoreChanged((name, insert, remove, revision) => namespaces.get(name)?.accept(insert, remove, revision))
  // Durability boundaries: the window going away, and it leaving the foreground.
  onBeforeDispose(flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush()
  })

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
