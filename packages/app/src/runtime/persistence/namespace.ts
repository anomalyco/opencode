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
  /** Apply changes another window made, without touching keys this window has queued. */
  accept(insert: Record<string, string>, remove: string[]): void
}

export const namespaceFlushDelay = 100

// In-memory truth for a namespace. Reads load the namespace once and are Map lookups from then
// on; writes update the cache immediately and are batched into one driver call per flush window,
// so a burst of setter calls costs one round trip. Mirrors VS Code's Storage class.
export function createNamespaceStorage(
  driver: NamespaceDriver,
  name: string,
  options: { delay?: number } = {},
): NamespaceStorage {
  const delay = options.delay ?? namespaceFlushDelay
  const cache = new Map<string, string>()
  const inserts = new Map<string, string>()
  const removes = new Set<string>()
  let loading: Promise<void> | undefined
  let inflight: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined

  const load = () =>
    (loading ??= driver.items(name).then((items) => {
      // Writes queued while loading are newer than what the driver returned.
      for (const [key, value] of Object.entries(items)) {
        if (!inserts.has(key) && !removes.has(key)) cache.set(key, value)
      }
    }))

  const schedule = () => {
    timer ??= setTimeout(() => void flush(), delay)
  }

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (inserts.size === 0 && removes.size === 0) return inflight
    const insert = Object.fromEntries(inserts)
    const remove = [...removes]
    inserts.clear()
    removes.clear()
    // Flushes run in order so a later batch never lands before an earlier one.
    inflight = inflight.then(() =>
      driver.update(name, insert, remove).catch((error: unknown) => {
        // Keep what has not been superseded queued for the next flush.
        for (const [key, value] of Object.entries(insert)) {
          if (!inserts.has(key) && !removes.has(key)) inserts.set(key, value)
        }
        for (const key of remove) if (!inserts.has(key) && !removes.has(key)) removes.add(key)
        console.error(`[persistence] flush failed for ${name}`, error)
      }),
    )
    return inflight
  }

  const storage: NamespaceStorage = {
    getItem: async (key) => {
      await load()
      return cache.get(key) ?? null
    },
    setItem: async (key, value) => {
      cache.set(key, value)
      removes.delete(key)
      inserts.set(key, value)
      schedule()
    },
    removeItem: async (key) => {
      cache.delete(key)
      inserts.delete(key)
      removes.add(key)
      schedule()
    },
    clear: async () => {
      clearTimeout(timer)
      timer = undefined
      cache.clear()
      inserts.clear()
      removes.clear()
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
      for (const [key, value] of Object.entries(insert)) {
        if (!inserts.has(key) && !removes.has(key)) cache.set(key, value)
      }
      for (const key of remove) if (!inserts.has(key) && !removes.has(key)) cache.delete(key)
    },
  }
  return storage
}
