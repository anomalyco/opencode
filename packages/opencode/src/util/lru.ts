export class LRUMap<K, V> {
  private cache = new Map<K, V>()
  private maxSize: number

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error("LRUMap maxSize must be at least 1")
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value === undefined) return undefined
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: K, value: V): this {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    while (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      }
    }
    this.cache.set(key, value)
    return this
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  keys(): IterableIterator<K> {
    return this.cache.keys()
  }

  values(): IterableIterator<V> {
    return this.cache.values()
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries()
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.cache[Symbol.iterator]()
  }

  forEach(fn: (value: V, key: K, map: LRUMap<K, V>) => void): void {
    this.cache.forEach((value, key) => fn(value, key, this))
  }
}
