import type { AsyncStorage, PersistenceSyncAPI, SyncStorage } from "@solid-primitives/storage"
import { getOwner, onCleanup, untrack } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"

export const persistSaveDelay = 100

const pending = new Set<() => void>()

/** Serialize and write every store with unsaved changes now. */
export function flushPersisted() {
  for (const save of [...pending]) save()
}

// Covers synchronous web storage. Desktop registers its own pagehide handling earlier than this
// module loads, so its shutdown path calls flushPersisted() itself before flushing namespaces.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersisted()
  })
  window.addEventListener("pagehide", flushPersisted)
}

// A store whose serialized form is written to storage on a schedule instead of on every setter
// call. The setter only marks the store dirty; serialization happens once per save window, once
// per owner cleanup, and when the page hides. Mirrors VS Code's Memento.
export function persistStore<T extends object>(input: {
  store: Store<T>
  setStore: SetStoreFunction<T>
  name: string
  storage: SyncStorage | AsyncStorage
  serialize: (value: T) => string
  deserialize: (raw: string) => T
  sync?: PersistenceSyncAPI
  delay?: number
}) {
  const delay = input.delay ?? persistSaveDelay
  let dirty = false
  let touched = false
  let last: string | undefined
  // The newest value another window wrote while this store was dirty; applied at save time if the
  // local setter calls turned out not to change anything.
  let remote: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const save = () => {
    clearTimeout(timer)
    timer = undefined
    pending.delete(save)
    if (!dirty) return
    dirty = false
    const held = remote
    remote = undefined
    const next = untrack(() => input.serialize(input.store))
    if (next === last) {
      if (held !== undefined && held !== last) hydrate(held)
      return
    }
    last = next
    input.sync?.[1](input.name, next)
    void input.storage.setItem(input.name, next)
  }

  // Solid's setter overloads are too deep to spread generically; the wrapper only forwards.
  const apply = input.setStore as unknown as (...values: unknown[]) => void
  const setStore = ((...values: unknown[]) => {
    apply(...values)
    dirty = true
    touched = true
    pending.add(save)
    timer ??= setTimeout(save, delay)
  }) as unknown as SetStoreFunction<T>

  const hydrate = (raw: string) => {
    last = raw
    input.setStore(reconcile(input.deserialize(raw)))
  }
  const init = input.storage.getItem(input.name)
  // A value the user already changed is newer than whatever storage held.
  if (init instanceof Promise) void init.then((raw) => raw && !touched && hydrate(raw))
  else if (init) hydrate(init)

  input.sync?.[0]((data) => {
    if (data.key !== input.name || (data.url ?? location.href) !== location.href) return
    if (!data.newValue) return
    // A real unsaved local change wins over another window's write, as in VS Code's storage
    // service; whether the change is real is only known when the store is serialized. Every
    // remote value replaces the held one, including a revert to `last`, so the save sees the
    // other window's final state rather than an intermediate one.
    if (dirty) {
      remote = data.newValue
      return
    }
    if (data.newValue === last) return
    hydrate(data.newValue)
  })

  if (getOwner()) onCleanup(save)

  return { setStore, init, flush: save }
}
