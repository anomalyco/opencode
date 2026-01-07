/**
 * A Map with LRU (Least Recently Used) eviction policy.
 * Uses the fact that JavaScript Maps maintain insertion order.
 * When capacity is exceeded, the oldest (first) entries are evicted.
 *
 * Calling {@link get} on an existing key moves that entry to the most recently
 * used position and therefore affects the eviction order. In contrast,
 * {@link has} only checks for the presence of a key and does not change the
 * recency or eviction order of entries.
 */
export class LRUMap<K, V> {
  private map = new Map<K, V>()
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || !Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`LRUMap capacity must be a positive integer, got: ${capacity}`)
    }
    this.capacity = capacity
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined
    }
    const value = this.map.get(key)!
    // Move to end (most recently used)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): this {
    // Delete first to ensure it goes to end if it exists
    this.map.delete(key)
    this.map.set(key, value)
    // Evict oldest entry if over capacity (can only exceed by 1 since we add one at a time)
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
    return this
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }

  keys(): IterableIterator<K> {
    return this.map.keys()
  }

  values(): IterableIterator<V> {
    return this.map.values()
  }

  entries(): IterableIterator<[K, V]> {
    return this.map.entries()
  }

  clear(): void {
    this.map.clear()
  }
}
