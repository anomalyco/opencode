import type { AsyncStorage } from "@solid-primitives/storage"

// The host-side store for one namespace: one bulk read, one bulk write.
export type NamespaceDriver = {
  items(name: string): Promise<Record<string, string>>
  update(name: string, insert: Record<string, string>, remove: string[]): Promise<void>
  clear(name: string): Promise<void>
}

export type NamespaceStorage = AsyncStorage & {
  /** Write every queued change now. Resolves when the driver has accepted it. */
  flush(): Promise<void>
  /** Apply changes another window made, without touching keys this window has changed locally. */
  accept(insert: Record<string, string>, remove: string[]): void
}

export const namespaceFlushDelay = 100

// In-memory truth for a namespace. Reads load the namespace once and are Map lookups from then
// on; writes update the cache immediately and are batched into one driver call per flush window,
// so a burst of setter calls costs one round trip. Mirrors VS Code's Storage class.
//
// Every local write gets a sequence number that stays recorded until the host has accepted that
// exact write. While it is recorded, neither the initial load, another window's change, nor a
// retry of an older batch may replace the key. Batches are posted as soon as they are cut, never
// behind an earlier reply, so a flush on pagehide is on the wire before the page goes away.
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
  let seq = 0
  let loading: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const load = () =>
    (loading ??= driver.items(name).then((items) => {
      for (const [key, value] of Object.entries(items)) {
        if (!local.has(key)) cache.set(key, value)
      }
    }))

  const write = (key: string, value: string | null) => {
    if (value === null) cache.delete(key)
    else cache.set(key, value)
    local.set(key, { seq: ++seq, value })
    dirty.add(key)
    timer ??= setTimeout(() => void flush(), delay)
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
        .then(() => batch.filter(current).forEach((entry) => local.delete(entry.key)))
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
    accept(insert, remove) {
      for (const [key, value] of Object.entries(insert)) if (!local.has(key)) cache.set(key, value)
      for (const key of remove) if (!local.has(key)) cache.delete(key)
    },
  }
  return storage
}
