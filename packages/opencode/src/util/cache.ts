import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { createHash } from "crypto"
import { Log } from "./log"

export interface CacheOptions {
  /** Maximum number of items in memory cache */
  maxSize?: number
  /** Time-to-live in milliseconds (default: 1 hour) */
  ttl?: number
  /** Whether to persist to disk (default: true) */
  persist?: boolean
  /** Cache namespace/subdirectory */
  namespace: string
}

interface CacheEntry<T> {
  value: T
  timestamp: number
  ttl: number
}

export interface CacheStats {
  namespace: string
  memorySize: number
  maxSize: number
  hits: number
  misses: number
  hitRate: number
}

const log = Log.create({ service: "cache" })

/**
 * LRU Cache with optional disk persistence
 * - In-memory LRU cache for fast access
 * - Disk persistence for cache survival across restarts
 * - TTL support for automatic expiration
 */
export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private readonly maxSize: number
  private readonly ttl: number
  private readonly persist: boolean
  private readonly cacheDir: string
  private readonly namespace: string
  private initialized = false
  private hits = 0
  private misses = 0

  constructor(options: CacheOptions) {
    this.namespace = options.namespace
    this.maxSize = options.maxSize ?? 1000
    this.ttl = options.ttl ?? 60 * 60 * 1000 // 1 hour default
    this.persist = options.persist ?? true
    this.cacheDir = path.join(Global.Path.cache, options.namespace)
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    if (this.persist) {
      await fs.mkdir(this.cacheDir, { recursive: true })
    }
    this.initialized = true
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex").slice(0, 16)
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl
  }

  private evictOldest(): void {
    if (this.cache.size >= this.maxSize) {
      // Map maintains insertion order, first key is oldest
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
  }

  /**
   * Get a value from cache
   * First checks memory, then disk if persistence is enabled
   */
  async get(key: string): Promise<T | undefined> {
    await this.ensureInit()

    const hashedKey = this.hashKey(key)

    // Check memory cache first
    const memEntry = this.cache.get(hashedKey)
    if (memEntry) {
      if (this.isExpired(memEntry)) {
        this.cache.delete(hashedKey)
        if (this.persist) {
          await this.deleteFromDisk(hashedKey).catch(() => {})
        }
        this.misses++
        log.info("cache miss (expired)", { namespace: this.namespace })
        return undefined
      }
      // Move to end (most recently used)
      this.cache.delete(hashedKey)
      this.cache.set(hashedKey, memEntry)
      this.hits++
      log.info("cache hit", { namespace: this.namespace, source: "memory" })
      return memEntry.value
    }

    // Check disk cache if persistence is enabled
    if (this.persist) {
      const diskEntry = await this.readFromDisk(hashedKey)
      if (diskEntry) {
        if (this.isExpired(diskEntry)) {
          await this.deleteFromDisk(hashedKey).catch(() => {})
          this.misses++
          log.info("cache miss (expired)", { namespace: this.namespace })
          return undefined
        }
        // Add back to memory cache
        this.evictOldest()
        this.cache.set(hashedKey, diskEntry)
        this.hits++
        log.info("cache hit", { namespace: this.namespace, source: "disk" })
        return diskEntry.value
      }
    }

    this.misses++
    log.info("cache miss", { namespace: this.namespace })
    return undefined
  }

  /**
   * Set a value in cache
   * Stores in memory and optionally persists to disk
   */
  async set(key: string, value: T, ttl?: number): Promise<void> {
    await this.ensureInit()

    const hashedKey = this.hashKey(key)
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttl ?? this.ttl,
    }

    // Evict oldest if at capacity
    this.evictOldest()

    // Set in memory
    this.cache.set(hashedKey, entry)

    // Persist to disk if enabled
    if (this.persist) {
      await this.writeToDisk(hashedKey, entry).catch(() => {
        // Silently fail disk writes - memory cache still works
      })
    }
  }

  /**
   * Check if a key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== undefined
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<void> {
    const hashedKey = this.hashKey(key)
    this.cache.delete(hashedKey)
    if (this.persist) {
      await this.deleteFromDisk(hashedKey).catch(() => {})
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
    if (this.persist) {
      try {
        const files = await fs.readdir(this.cacheDir)
        await Promise.all(files.map((file) => fs.unlink(path.join(this.cacheDir, file)).catch(() => {})))
      } catch {
        // Directory might not exist
      }
    }
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this.hits + this.misses
    return {
      namespace: this.namespace,
      memorySize: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    }
  }

  private async readFromDisk(hashedKey: string): Promise<CacheEntry<T> | undefined> {
    try {
      const filePath = path.join(this.cacheDir, `${hashedKey}.json`)
      const content = await fs.readFile(filePath, "utf-8")
      return JSON.parse(content) as CacheEntry<T>
    } catch {
      return undefined
    }
  }

  private async writeToDisk(hashedKey: string, entry: CacheEntry<T>): Promise<void> {
    const filePath = path.join(this.cacheDir, `${hashedKey}.json`)
    await fs.writeFile(filePath, JSON.stringify(entry), "utf-8")
  }

  private async deleteFromDisk(hashedKey: string): Promise<void> {
    const filePath = path.join(this.cacheDir, `${hashedKey}.json`)
    await fs.unlink(filePath)
  }
}
