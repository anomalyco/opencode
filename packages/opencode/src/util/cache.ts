/**
 * LRU cache with max entries limit for preventing memory leaks
 */

export type LruCacheOpts = {
  maxEntries?: number
  onEvict?: (key: any, value: any) => void
}

type LruCacheEntry<V> = {
  value: V
  lastAccess: number
}

export function createLruCache<K = any, V = any>(opts: LruCacheOpts = {}) {
  const { maxEntries = Infinity, onEvict } = opts
  const cache = new Map<K, LruCacheEntry<V>>()

  function evictOne() {
    let oldestKey: K | null = null
    let oldestAccess = Infinity

    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess
        oldestKey = key
      }
    }

    if (oldestKey !== null) {
      delete_(oldestKey)
    }
  }

  function delete_(key: K): boolean {
    const entry = cache.get(key)
    if (!entry) return false
    onEvict?.(key, entry.value)
    return cache.delete(key)
  }

  return {
    get(key: K): V | undefined {
      const entry = cache.get(key)
      if (!entry) return undefined
      entry.lastAccess = Date.now()
      return entry.value
    },

    set(key: K, value: V): void {
      if (cache.size >= maxEntries && !cache.has(key)) {
        evictOne()
      }
      cache.set(key, { value, lastAccess: Date.now() })
    },

    has(key: K): boolean {
      return cache.has(key)
    },

    delete(key: K): boolean {
      return delete_(key)
    },

    clear(): void {
      for (const [key, entry] of cache) {
        onEvict?.(key, entry.value)
      }
      cache.clear()
    },

    get size() {
      return cache.size
    },
  }
}
