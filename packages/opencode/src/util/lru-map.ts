/**
 * A Map with LRU (Least Recently Used) eviction policy.
 * Uses the fact that JavaScript Maps maintain insertion order.
 * When capacity is exceeded, the oldest (first) entries are evicted.
 */
export class LRUMap<K, V> {
  private map = new Map<K, V>()
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: K, value: V): this {
    // Delete first to ensure it goes to end if it exists
    this.map.delete(key)
    this.map.set(key, value)
    // Evict oldest entries if over capacity
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
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
