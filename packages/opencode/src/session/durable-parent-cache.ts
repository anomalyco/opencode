// Positive cache for the durable-parent lookup. That lookup walks a session's historical message
// events, so the result is cached per message; the capacity bound and LRU eviction keep a long-lived
// server from retaining an identity for every message it has ever summarized.
const DEFAULT_CAPACITY = 4096

export function createDurableParentCache(capacity = DEFAULT_CAPACITY) {
  const entries = new Map<string, true>()
  return {
    has(key: string) {
      if (!entries.delete(key)) return false
      entries.set(key, true)
      return true
    },
    add(key: string) {
      entries.delete(key)
      entries.set(key, true)
      if (entries.size <= capacity) return
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    },
    get size() {
      return entries.size
    },
  }
}

export * as DurableParentCache from "./durable-parent-cache"
