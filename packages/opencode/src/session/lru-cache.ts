// Bounded LRU over a Map: a hit re-inserts the key so recency follows access,
// and an insert past capacity evicts the least-recently-used entry.
const DEFAULT_CAPACITY = 32

export function createLruCache<K, V>(capacity = DEFAULT_CAPACITY) {
  const entries = new Map<K, V>()
  return {
    get(key: K) {
      const hit = entries.get(key)
      if (hit === undefined) return undefined
      entries.delete(key)
      entries.set(key, hit)
      return hit
    },
    set(key: K, value: V) {
      entries.delete(key)
      entries.set(key, value)
      if (entries.size <= capacity) return
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    },
    get size() {
      return entries.size
    },
  }
}

export * as LruCache from "./lru-cache"
