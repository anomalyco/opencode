import type { AsyncStorage } from "@solid-primitives/storage"

// The host-side store for one namespace: one bulk read, one bulk write. The host stamps every
// update with a monotonic revision and reports it with reads, acks, and change events.
export type NamespaceDriver = {
  items(name: string): Promise<{ items: Record<string, string>; revision: number }>
  update(name: string, insert: Record<string, string>, remove: string[]): Promise<number>
  clear(name: string): Promise<void>
}

export type NamespaceStorage = AsyncStorage & {
  /** Write every queued change now. Resolves when the driver has accepted it. */
  flush(): Promise<void>
  /** Apply a change another window made at `revision`, unless this window already holds something newer. */
  accept(insert: Record<string, string>, remove: string[], revision: number): void
}

export const namespaceFlushDelay = 100

// In-memory truth for a namespace. Reads load the namespace once and are Map lookups from then
// on; writes update the cache immediately and are batched into one driver call per flush window,
// so a burst of setter calls costs one round trip. Mirrors VS Code's Storage class.
//
// Two orderings keep the cache correct. Every local write gets a sequence number that stays
// recorded until the host acks that exact write; while recorded, nothing external may replace
// the key. Every value the cache holds also carries the host revision it came from, so an event
// that reaches this window after a newer ack or load is recognised as stale and dropped. Batches
// are posted as soon as they are cut, never behind an earlier reply, so a flush on pagehide is
// on the wire before the page goes away.
export function createNamespaceStorage(
  driver: NamespaceDriver,
  name: string,
  options: { delay?: number } = {},
): NamespaceStorage {
  const delay = options.delay ?? namespaceFlushDelay
  const cache = new Map<string, string>()
  const local = new Map<string, { seq: number; value: string | null }>()
  const dirty = new Set<string>()
  const inflight = new Set<Promise<void>>()
  // Host revision behind each cached key, and the revision the initial load reflected for all keys.
  const applied = new Map<string, number>()
  let floor = -1
  // The newest external change for a key that arrived while a local write was still in flight.
  const deferred = new Map<string, { revision: number; value: string | null }>()
  let seq = 0
  let loading: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const place = (key: string, value: string | null, revision: number) => {
    if (value === null) cache.delete(key)
    else cache.set(key, value)
    applied.set(key, revision)
  }

  // The snapshot is the whole truth at its revision: a key it lacks was deleted by then, even if
  // an older event inserted it into the cache while the load was in flight.
  const load = () =>
    (loading ??= driver.items(name).then((loaded) => {
      floor = loaded.revision
      const stale = (key: string) => !local.has(key) && (applied.get(key) ?? -1) <= loaded.revision
      for (const key of [...cache.keys()]) {
        if (!(key in loaded.items) && stale(key)) place(key, null, loaded.revision)
      }
      for (const [key, value] of Object.entries(loaded.items)) {
        if (stale(key)) place(key, value, loaded.revision)
      }
    }))

  const write = (key: string, value: string | null) => {
    if (value === null) cache.delete(key)
    else cache.set(key, value)
    local.set(key, { seq: ++seq, value })
    dirty.add(key)
    timer ??= setTimeout(() => void flush(), delay)
  }

  // The host accepted this window's value for `key` at `revision`. A change from another window
  // that was held back meanwhile wins if the host applied it later than ours.
  const acknowledge = (key: string, revision: number) => {
    local.delete(key)
    const later = deferred.get(key)
    deferred.delete(key)
    if (later && later.revision > revision) return place(key, later.value, later.revision)
    applied.set(key, revision)
  }

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (dirty.size > 0) {
      const batch = [...dirty].map((key) => ({ key, ...local.get(key)! }))
      dirty.clear()
      const insert = Object.fromEntries(batch.filter((entry) => entry.value !== null).map((e) => [e.key, e.value!]))
      const remove = batch.filter((entry) => entry.value === null).map((entry) => entry.key)
      const current = (entry: { key: string; seq: number }) => local.get(entry.key)?.seq === entry.seq
      const request = driver
        .update(name, insert, remove)
        .then((revision) => batch.filter(current).forEach((entry) => acknowledge(entry.key, revision)))
        .catch((error: unknown) => {
          // Only a value nothing newer has replaced is worth retrying.
          batch.filter(current).forEach((entry) => dirty.add(entry.key))
          console.error(`[persistence] flush failed for ${name}`, error)
        })
        .finally(() => inflight.delete(request))
      inflight.add(request)
    }
    return Promise.all(inflight).then(() => undefined)
  }

  const storage: NamespaceStorage = {
    getItem: async (key) => {
      await load()
      return cache.get(key) ?? null
    },
    setItem: async (key, value) => write(key, value),
    removeItem: async (key) => write(key, null),
    clear: async () => {
      clearTimeout(timer)
      timer = undefined
      cache.clear()
      local.clear()
      dirty.clear()
      applied.clear()
      deferred.clear()
      loading = Promise.resolve()
      await driver.clear(name)
    },
    key: async (index: number) => {
      await load()
      return [...cache.keys()][index]
    },
    getLength: async () => {
      await load()
      return cache.size
    },
    get length() {
      return storage.getLength()
    },
    flush,
    accept(insert, remove, revision) {
      // The initial load already reflects everything up to `floor`.
      if (revision <= floor) return
      const changes = [
        ...Object.entries(insert).map(([key, value]) => [key, value] as const),
        ...remove.map((key) => [key, null] as const),
      ]
      for (const [key, value] of changes) {
        if (local.has(key)) {
          const held = deferred.get(key)
          if (!held || revision > held.revision) deferred.set(key, { revision, value })
          continue
        }
        if (revision <= (applied.get(key) ?? floor)) continue
        place(key, value, revision)
      }
    },
  }
  return storage
}
