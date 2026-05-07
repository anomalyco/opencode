/**
 * 简单 TTL 内存缓存
 *
 * 用于 Obsidian KB 查询结果缓存，避免重复 FTS5/全扫描。
 * 不依赖外部库，容量上限自动淘汰最旧条目。
 */

const DEFAULT_TTL = 5 * 60 * 1000 // 5 分钟
const DEFAULT_MAX_SIZE = 200

export class SimpleCache<T> {
  private store = new Map<string, { value: T; expires: number }>()
  private readonly ttl: number
  private readonly maxSize: number

  constructor(options?: { ttlMs?: number; maxSize?: number }) {
    this.ttl = options?.ttlMs ?? DEFAULT_TTL
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expires) {
      this.store.delete(key)
      return undefined
    }

    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    // 容量上限时淘汰最旧的 25%
    if (this.store.size >= this.maxSize) {
      const keysToDelete = [...this.store.keys()].slice(0, Math.floor(this.maxSize * 0.25))
      keysToDelete.forEach(k => this.store.delete(k))
    }

    this.store.set(key, {
      value,
      expires: Date.now() + (ttlMs ?? this.ttl),
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}
