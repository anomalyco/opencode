import {
  createDraftStore,
  createNamespaceStorage,
  flushPersisted,
  type NamespaceStorage,
  type Platform,
} from "@opencode/app/desktop"
import { getOwner, onCleanup } from "solid-js"
import type { ElectronAPI } from "../api-types"
import { onBeforeDispose } from "../ipc-client"
import {
  createDesktopStorageState,
  selectOpenedNamespace,
  selectOpenedNamespaces,
  transitionDesktopStorage,
  type DesktopStorageEffect,
  type DesktopStorageEvent,
  type StorageItems,
} from "./storage-machine"

export function createDesktopStorage(api: ElectronAPI) {
  let state = createDesktopStorageState<NamespaceStorage>()

  const dispatch = (event: DesktopStorageEvent<NamespaceStorage>) => {
    const next = transitionDesktopStorage(state, event)
    state = next.state
    next.effects.forEach(run)
  }

  const run = (effect: DesktopStorageEffect<NamespaceStorage>) => {
    if (effect.type === "resolve-items") return effect.reply.resolve(effect.value)

    if (effect.type === "fetch-items") return effect.reply.resolve(api.storeItems(effect.name))

    if (effect.type === "reject-items") return effect.reply.reject(new Error("Desktop storage disposed"))
    effect.namespace.accept(effect.insert, effect.remove, effect.revision)
  }

  const driver = {
    items: (name: string) => {
      const reply = Promise.withResolvers<StorageItems>()
      dispatch({ type: "items.requested", name, reply })

      return reply.promise
    },
    update: api.storeUpdate,
    clear: api.storeClear,
  }

  const storage: NonNullable<Platform["storage"]> = (name = "default.dat") => {
    const cached = selectOpenedNamespace(state, name)

    if (cached) return cached
    const next = createNamespaceStorage(driver, name)
    dispatch({ type: "namespace.opened", name, namespace: next })

    return next
  }

  // Dirty stores must serialize into their namespaces before the namespaces are sent; the app's
  // own pagehide listener registers after the IPC client's, so it cannot be relied on here.
  const flush = () => {
    flushPersisted()

    return Promise.all(selectOpenedNamespaces(state).map((namespace) => namespace.flush()))
  }

  const stopStoreChanged = api.onStoreChanged((name, insert, remove, revision) =>
    dispatch({ type: "store.changed", name, insert, remove, revision }),
  )

  void api.getStorageSnapshot().then(
    (snapshot) => dispatch({ type: "snapshot.settled", snapshot }),
    () => dispatch({ type: "snapshot.settled", snapshot: {} }),
  )

  // The flush hooks stay: writes already queued in the namespaces must still reach main.
  if (getOwner()) {
    onCleanup(() => {
      stopStoreChanged()
      dispatch({ type: "disposed" })
    })
  }

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
