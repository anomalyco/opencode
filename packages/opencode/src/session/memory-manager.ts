import { Log } from "../util/log"

export namespace SessionMemoryManager {
  const log = Log.create({ service: "session-memory-manager" })

  // Configuration constants
  const DEFAULT_MAX_SESSIONS = 100
  const DEFAULT_MAX_MESSAGES_PER_SESSION = 1000
  const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  const DEFAULT_INACTIVE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours
  const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
  const MEMORY_PRESSURE_THRESHOLD = 0.8 // 80% of max sessions

  interface SessionCacheEntry<T> {
    value: T
    lastAccessed: number
    created: number
    accessCount: number
  }

  interface CacheConfig {
    maxSize: number
    ttlMs: number
    inactiveTtlMs: number
  }

  interface CacheStats {
    size: number
    hits: number
    misses: number
    evictions: number
    memoryPressure: number
  }

  export class LRUCache<T> {
    private cache = new Map<string, SessionCacheEntry<T>>()
    private accessOrder: string[] = []
    private stats: CacheStats = {
      size: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      memoryPressure: 0,
    }

    constructor(private config: CacheConfig) {}

    get(key: string): T | undefined {
      const entry = this.cache.get(key)
      if (!entry) {
        this.stats.misses++
        return undefined
      }

      // Check TTL expiration
      const now = Date.now()
      const age = now - entry.created
      const inactiveTime = now - entry.lastAccessed

      if (age > this.config.ttlMs || inactiveTime > this.config.inactiveTtlMs) {
        this.delete(key)
        this.stats.misses++
        return undefined
      }

      // Update access tracking
      entry.lastAccessed = now
      entry.accessCount++
      this.updateAccessOrder(key)
      this.stats.hits++

      return entry.value
    }

    set(key: string, value: T): void {
      const now = Date.now()
      
      // If key exists, update it
      if (this.cache.has(key)) {
        const entry = this.cache.get(key)!
        entry.value = value
        entry.lastAccessed = now
        entry.accessCount++
        this.updateAccessOrder(key)
        return
      }

      // Check if we need to evict
      this.evictIfNeeded()

      // Add new entry
      const entry: SessionCacheEntry<T> = {
        value,
        lastAccessed: now,
        created: now,
        accessCount: 1,
      }

      this.cache.set(key, entry)
      this.accessOrder.push(key)
      this.stats.size = this.cache.size
      this.stats.memoryPressure = this.cache.size / this.config.maxSize
    }

    delete(key: string): boolean {
      const deleted = this.cache.delete(key)
      if (deleted) {
        this.accessOrder = this.accessOrder.filter(k => k !== key)
        this.stats.size = this.cache.size
        this.stats.memoryPressure = this.cache.size / this.config.maxSize
      }
      return deleted
    }

    has(key: string): boolean {
      const entry = this.cache.get(key)
      if (!entry) return false

      // Check TTL expiration
      const now = Date.now()
      const age = now - entry.created
      const inactiveTime = now - entry.lastAccessed

      if (age > this.config.ttlMs || inactiveTime > this.config.inactiveTtlMs) {
        this.delete(key)
        return false
      }

      return true
    }

    clear(): void {
      this.cache.clear()
      this.accessOrder = []
      this.stats.size = 0
      this.stats.memoryPressure = 0
    }

    size(): number {
      return this.cache.size
    }

    keys(): IterableIterator<string> {
      return this.cache.keys()
    }

    getStats(): CacheStats {
      return { ...this.stats }
    }

    private updateAccessOrder(key: string): void {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== key)
      this.accessOrder.push(key)
    }

    private evictIfNeeded(): void {
      // Evict expired entries first
      this.evictExpired()

      // If still over limit, evict LRU entries
      while (this.cache.size >= this.config.maxSize) {
        this.evictLRU()
      }

      // Under memory pressure, be more aggressive
      if (this.stats.memoryPressure > MEMORY_PRESSURE_THRESHOLD) {
        this.evictByMemoryPressure()
      }
    }

    private evictExpired(): void {
      const now = Date.now()
      const expiredKeys: string[] = []

      for (const [key, entry] of this.cache.entries()) {
        const age = now - entry.created
        const inactiveTime = now - entry.lastAccessed

        if (age > this.config.ttlMs || inactiveTime > this.config.inactiveTtlMs) {
          expiredKeys.push(key)
        }
      }

      for (const key of expiredKeys) {
        this.delete(key)
        this.stats.evictions++
        log.debug("evicted expired session", { key, reason: "ttl" })
      }
    }

    private evictLRU(): void {
      if (this.accessOrder.length === 0) return

      const lruKey = this.accessOrder[0]
      this.delete(lruKey)
      this.stats.evictions++
      log.debug("evicted session", { key: lruKey, reason: "lru" })
    }

    private evictByMemoryPressure(): void {
      // Under memory pressure, evict sessions with low access count
      const entries = Array.from(this.cache.entries())
        .sort(([, a], [, b]) => a.accessCount - b.accessCount)

      const toEvict = Math.ceil(this.cache.size * 0.1) // Evict 10%
      
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        const [key] = entries[i]
        this.delete(key)
        this.stats.evictions++
        log.debug("evicted session", { key, reason: "memory-pressure" })
      }
    }
  }

  export class SessionCache {
    private sessionCache: LRUCache<any>
    private messageCache: LRUCache<any[]>
    private cleanupInterval: NodeJS.Timeout | undefined

    constructor(config?: Partial<{
      maxSessions: number
      maxMessagesPerSession: number
      sessionTtlMs: number
      inactiveTtlMs: number
      cleanupIntervalMs: number
    }>) {
      const sessionConfig: CacheConfig = {
        maxSize: config?.maxSessions ?? DEFAULT_MAX_SESSIONS,
        ttlMs: config?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
        inactiveTtlMs: config?.inactiveTtlMs ?? DEFAULT_INACTIVE_TTL_MS,
      }

      const messageConfig: CacheConfig = {
        maxSize: config?.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES_PER_SESSION,
        ttlMs: config?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
        inactiveTtlMs: config?.inactiveTtlMs ?? DEFAULT_INACTIVE_TTL_MS,
      }

      this.sessionCache = new LRUCache(sessionConfig)
      this.messageCache = new LRUCache(messageConfig)

      // Start background cleanup
      this.startCleanup(config?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS)

      log.info("initialized session memory manager", {
        maxSessions: sessionConfig.maxSize,
        maxMessages: messageConfig.maxSize,
        sessionTtlMs: sessionConfig.ttlMs,
        inactiveTtlMs: sessionConfig.inactiveTtlMs,
      })
    }

    // Session cache methods
    getSession(key: string): any | undefined {
      return this.sessionCache.get(key)
    }

    setSession(key: string, value: any): void {
      this.sessionCache.set(key, value)
    }

    deleteSession(key: string): boolean {
      const deleted = this.sessionCache.delete(key)
      if (deleted) {
        // Also delete associated messages
        this.messageCache.delete(key)
      }
      return deleted
    }

    hasSession(key: string): boolean {
      return this.sessionCache.has(key)
    }

    // Message cache methods
    getMessages(sessionId: string): any[] | undefined {
      return this.messageCache.get(sessionId)
    }

    setMessages(sessionId: string, messages: any[]): void {
      this.messageCache.set(sessionId, messages)
    }

    deleteMessages(sessionId: string): boolean {
      return this.messageCache.delete(sessionId)
    }

    // Utility methods
    clear(): void {
      this.sessionCache.clear()
      this.messageCache.clear()
      log.info("cleared all caches")
    }

    getStats(): {
      sessions: CacheStats
      messages: CacheStats
      totalMemoryUsage: number
    } {
      const sessionStats = this.sessionCache.getStats()
      const messageStats = this.messageCache.getStats()
      
      return {
        sessions: sessionStats,
        messages: messageStats,
        totalMemoryUsage: sessionStats.memoryPressure + messageStats.memoryPressure,
      }
    }

    getSessionKeys(): IterableIterator<string> {
      return this.sessionCache.keys()
    }

    size(): { sessions: number; messages: number } {
      return {
        sessions: this.sessionCache.size(),
        messages: this.messageCache.size(),
      }
    }

    // Memory pressure handling
    isUnderMemoryPressure(): boolean {
      const stats = this.getStats()
      return stats.totalMemoryUsage > MEMORY_PRESSURE_THRESHOLD
    }

    forceCleanup(): void {
      log.info("forcing memory cleanup")
      
      // Force eviction of expired entries
      const sessionKeys = Array.from(this.sessionCache.keys())
      const messageKeys = Array.from(this.messageCache.keys())

      for (const key of sessionKeys) {
        // Re-accessing will trigger TTL checks
        this.sessionCache.get(key)
      }

      for (const key of messageKeys) {
        this.messageCache.get(key)
      }

      const stats = this.getStats()
      log.info("memory cleanup completed", {
        sessionsRemaining: stats.sessions.size,
        messagesRemaining: stats.messages.size,
        memoryPressure: stats.totalMemoryUsage,
      })
    }

    private startCleanup(intervalMs: number): void {
      this.cleanupInterval = setInterval(() => {
        this.forceCleanup()
      }, intervalMs)

      log.debug("started background cleanup", { intervalMs })
    }

    destroy(): void {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = undefined
      }
      this.clear()
      log.info("destroyed session memory manager")
    }
  }

  // Singleton instance for global use
  let globalCache: SessionCache | undefined

  export function getGlobalCache(): SessionCache {
    if (!globalCache) {
      globalCache = new SessionCache()
    }
    return globalCache
  }

  export function destroyGlobalCache(): void {
    if (globalCache) {
      globalCache.destroy()
      globalCache = undefined
    }
  }
}