/**
 * Semantic code search index cache with mtime-based invalidation.
 *
 * Caches LSP symbol indexes and file search results for frequently accessed files.
 * Automatically invalidates when file modification times change.
 *
 * Features:
 * - Content hash + mtime-based cache keys
 * - Per-file caching of search results
 * - Automatic invalidation on file modification
 * - LRU eviction when cache grows too large
 */

import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { Global } from "@/global"
import { Log } from "./log"

export namespace FileCache {
  const log = Log.create({ service: "file_cache" })

  // Configuration
  const DEFAULT_MAX_FILES = 10000
  const DEFAULT_MAX_SIZE_MB = 200
  const HASH_SAMPLE_SIZE = 8192

  // Interfaces
  export interface FileIndex {
    cachedFiles: number
    totalSizeMb: number
    totalAccesses: number
    maxFiles: number
    maxSizeMb: number
  }

  export interface CachedSymbols {
    filePath: string
    contentHash: string
    mtime: number
    indexedAt: number
    symbols: unknown[]
    sizeBytes: number
    accessCount: number
    lastAccessed: number
  }

  // In-memory index
  let index: Map<string, CachedSymbols> = new Map()
  let accessOrder: string[] = []
  let maxFiles = DEFAULT_MAX_FILES
  let maxSizeBytes = DEFAULT_MAX_SIZE_MB * 1024 * 1024
  let cacheDir = ""
  let initialized = false

  /**
   * Initialize the file cache.
   */
  export function init(dir?: string, files?: number, sizeMb?: number): void {
    if (initialized) return

    cacheDir = dir ?? join(Global.Path.data, "cache", "file_search")
    maxFiles = files ?? DEFAULT_MAX_FILES
    maxSizeBytes = (sizeMb ?? DEFAULT_MAX_SIZE_MB) * 1024 * 1024

    mkdirSync(cacheDir, { recursive: true })

    loadIndex()
    initialized = true
    log.info("file cache initialized", { cacheDir, maxFiles, sizeMb })
  }

  function getMetaPath(filePath: string): string {
    // Hash the file path for the meta file
    const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16)
    return join(cacheDir, `${hash}.json`)
  }

  function loadIndex(): void {
    if (!existsSync(cacheDir)) return

    try {
      const files = readdirSyncRecursive(cacheDir)
      const now = Date.now()

      index = new Map()
      accessOrder = []

      for (const file of files) {
        if (!file.endsWith(".json")) continue

        try {
          const data: CachedSymbols = JSON.parse(readFileSync(file, "utf-8"))

          // Verify file still exists and mtime matches
          const originalPath = data.filePath
          if (!existsSync(originalPath)) continue

          const currentMtime = statSync(originalPath).mtimeMs
          if (Math.abs(currentMtime - data.mtime) > 0.001) continue

          index.set(originalPath, data)
          accessOrder.push(originalPath)
        } catch {}
      }

      // Trim access order to only include cached files
      accessOrder = accessOrder.filter((f) => index.has(f))

      log.info("file cache index loaded", { entries: index.size })
    } catch (err) {
      log.warn("failed to load file cache index", { err })
    }
  }

  function readdirSyncRecursive(dir: string): string[] {
    const results: string[] = []
    try {
      const entries = require("fs").readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...readdirSyncRecursive(full))
        } else {
          results.push(full)
        }
      }
    } catch {}
    return results
  }

  /**
   * Compute cache key for a file.
   */
  export function computeKey(filePath: string, content: Buffer): { contentHash: string; cacheKey: string } {
    // Use sample-based hash for speed on large files
    let sample: Buffer
    if (content.length > HASH_SAMPLE_SIZE) {
      const half = Math.floor(content.length / 2)
      sample = Buffer.concat([
        content.slice(0, HASH_SAMPLE_SIZE / 2),
        content.slice(half, half + HASH_SAMPLE_SIZE / 4),
        content.slice(-HASH_SAMPLE_SIZE / 4),
      ])
    } else {
      sample = content
    }

    const contentHash = createHash("sha256").update(sample).digest("hex")

    let mtime = 0
    try {
      mtime = statSync(filePath).mtimeMs
    } catch {}

    const cacheKey = createHash("sha256")
      .update(JSON.stringify({ path: filePath, contentHash, mtime }))
      .digest("hex")

    return { contentHash, cacheKey }
  }

  /**
   * Get cached symbols for a file.
   */
  export function getFileIndex(filePath: string): [unknown[] | null, boolean] {
    if (!initialized) init()

    const entry = index.get(filePath)
    if (!entry) return [null, false]

    // Check if file was modified
    try {
      const currentMtime = statSync(filePath).mtimeMs
      if (Math.abs(currentMtime - entry.mtime) > 0.001) {
        index.delete(filePath)
        accessOrder = accessOrder.filter((f) => f !== filePath)
        return [null, false]
      }
    } catch {
      return [null, false]
    }

    // Update access stats
    entry.lastAccessed = Date.now()
    entry.accessCount++

    // Move to end of LRU list
    accessOrder = accessOrder.filter((f) => f !== filePath)
    accessOrder.push(filePath)

    return [entry.symbols, true]
  }

  /**
   * Cache symbols for a file.
   */
  export function setFileIndex(
    filePath: string,
    content: Buffer,
    symbols: unknown[],
  ): boolean {
    if (!initialized) init()

    try {
      const mtime = statSync(filePath).mtimeMs
      const { contentHash } = computeKey(filePath, content)

      const now = Date.now()
      const sizeBytes = content.length + Buffer.byteLength(JSON.stringify(symbols), "utf-8")

      const entry: CachedSymbols = {
        filePath,
        contentHash,
        mtime,
        indexedAt: now,
        symbols,
        sizeBytes,
        lastAccessed: now,
        accessCount: 0,
      }

      // Evict if needed
      evictIfNeeded()

      // Remove old entry if exists
      if (index.has(filePath)) {
        index.delete(filePath)
        accessOrder = accessOrder.filter((f) => f !== filePath)
      }

      index.set(filePath, entry)
      accessOrder.push(filePath)

      // Save metadata
      const metaPath = getMetaPath(filePath)
      const tempPath = `${metaPath}.tmp`
      writeFileSync(tempPath, JSON.stringify(entry, null, 2), "utf-8")
      renameSync(tempPath, metaPath)

      return true
    } catch (err) {
      log.warn("failed to cache file index", { err })
      return false
    }
  }

  function evictIfNeeded(): void {
    // Check file count limit
    while (index.size > maxFiles) {
      if (accessOrder.length === 0) break
      const oldest = accessOrder.shift()
      if (oldest) {
        index.delete(oldest)
        const metaPath = getMetaPath(oldest)
        try {
          unlinkSync(metaPath)
        } catch {}
        log.debug("evicted file from cache", { path: oldest })
      }
    }

    // Check size limit
    let currentSize = 0
    for (const entry of index.values()) {
      currentSize += entry.sizeBytes
    }

    while (currentSize > maxSizeBytes && accessOrder.length > 0) {
      const oldest = accessOrder.shift()
      if (oldest) {
        const entry = index.get(oldest)
        if (entry) {
          currentSize -= entry.sizeBytes
          index.delete(oldest)
          const metaPath = getMetaPath(oldest)
          try {
            unlinkSync(metaPath)
          } catch {}
        }
      }
    }
  }

  /**
   * Invalidate cache for a specific file.
   */
  export function invalidateFile(filePath: string): boolean {
    if (!index.has(filePath)) return false

    index.delete(filePath)
    accessOrder = accessOrder.filter((f) => f !== filePath)

    const metaPath = getMetaPath(filePath)
    try {
      unlinkSync(metaPath)
    } catch {}

    return true
  }

  /**
   * Invalidate cache for all files in a directory.
   */
  export function invalidateDir(dirPath: string): number {
    let invalidated = 0

    for (const filePath of index.keys()) {
      if (filePath.startsWith(dirPath)) {
        index.delete(filePath)
        accessOrder = accessOrder.filter((f) => f !== filePath)
        const metaPath = getMetaPath(filePath)
        try {
          unlinkSync(metaPath)
        } catch {}
        invalidated++
      }
    }

    return invalidated
  }

  /**
   * Clear all cached indexes.
   */
  export function clear(): number {
    const count = index.size

    index.clear()
    accessOrder = []

    log.info("file cache cleared", { count })
    return count
  }

  /**
   * Get cache statistics.
   */
  export function stats(): FileIndex {
    let totalSize = 0
    let totalAccesses = 0

    for (const entry of index.values()) {
      totalSize += entry.sizeBytes
      totalAccesses += entry.accessCount
    }

    return {
      cachedFiles: index.size,
      totalSizeMb: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      totalAccesses,
      maxFiles,
      maxSizeMb: maxSizeBytes / 1024 / 1024,
    }
  }
}
