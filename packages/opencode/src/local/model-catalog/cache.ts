import type { CatalogSearchResult, ModelCandidate, CatalogFreshness } from "./types"

const DEFAULT_TTL_MS = 60 * 60 * 1000 // 1 hour
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes after TTL, serve stale

export type CacheEntry = {
  etag: string
  revision: string
  result: CatalogSearchResult
  fetchedAt: number
  ttlMs: number
}

export type CacheStats = {
  hits: number
  misses: number
  staleHits: number
  evictions: number
}

export type CacheStatus =
  | { type: "fresh" }
  | { type: "stale" }
  | { type: "miss" }

export type CacheOptions = {
  ttlMs?: number
  staleThresholdMs?: number
  clock?: () => number
}

/**
 * In-memory cache for Hugging Face catalog search results with ETag/revision
 * awareness, TTL, and stale fallback.
 *
 * When a cached entry is past its TTL but within the stale threshold, it is
 * served with "stale-cache" freshness so the UI can render while a background
 * refresh happens.
 *
 * When a cached entry is past both TTL and stale threshold, it is evicted.
 */
export function createCatalogCache(options: CacheOptions = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const staleThresholdMs = options.staleThresholdMs ?? STALE_THRESHOLD_MS
  const clock = options.clock ?? (() => Date.now())

  const store = new Map<string, CacheEntry>()
  let stats: CacheStats = { hits: 0, misses: 0, staleHits: 0, evictions: 0 }

  return {
    stats,
    store,

    get(key: string): CacheStatus & { entry?: CacheEntry } {
      const entry = store.get(key)
      if (!entry) {
        stats.misses++
        return { type: "miss" }
      }

      const now = clock()
      const age = now - entry.fetchedAt

      if (age < entry.ttlMs) {
        stats.hits++
        return { type: "fresh", entry }
      }

      if (age < entry.ttlMs + staleThresholdMs) {
        stats.staleHits++
        return { type: "stale", entry }
      }

      // Past TTL + stale threshold — evict
      store.delete(key)
      stats.evictions++
      stats.misses++
      return { type: "miss" }
    },

    set(key: string, input: {
      etag: string
      revision: string
      result: CatalogSearchResult
      ttlMs?: number
    }): void {
      const entry: CacheEntry = {
        etag: input.etag,
        revision: input.revision,
        result: input.result,
        fetchedAt: clock(),
        ttlMs: input.ttlMs ?? ttlMs,
      }
      store.set(key, entry)
    },

    invalidate(key: string): void {
      store.delete(key)
    },

    invalidateByRevision(revision: string): void {
      for (const [key, entry] of store.entries()) {
        if (entry.revision === revision) store.delete(key)
      }
    },

    clear(): void {
      store.clear()
    },

    keys(): string[] {
      return [...store.keys()]
    },

    size(): number {
      return store.size
    },
  }
}

/**
 * Wrap a Hugging Face search function with cache logic. On cache hit, returns
 * the cached result with appropriate freshness. On miss or eviction, calls the
 * underlying fetcher and stores the result.
 *
 * The cache key is derived from the query string and limit.
 */
export function withCache(
  fetcher: (query: string, limit: number) => Promise<CatalogSearchResult>,
  cache: ReturnType<typeof createCatalogCache>,
  options?: {
    /** Custom TTL for individual cache entries. */
    ttlMs?: number
  },
  // The wrapper adds `freshness` to every result (live / fresh-cache /
  // stale-cache), so the returned signature is wider than the fetcher's —
  // matching `seedResult` below, which tags "seed" the same way.
): (query: string, limit: number) => Promise<CatalogSearchResult & { freshness: CatalogFreshness }> {
  return async (query: string, limit: number) => {
    const key = cacheKey(query, limit)
    const hit = cache.get(key)

    if (hit.type !== "miss") {
      const result = hit.entry!.result
      // Tag the result with cache freshness.
      return {
        ...result,
        freshness: hit.type === "stale" ? ("stale-cache" as const) : ("fresh-cache" as const),
      }
    }

    const result = await fetcher(query, limit)
    const revision = result.candidates[0]?.revision ?? "unknown"
    cache.set(key, {
      etag: `v1-${query}-${limit}`,
      revision,
      result,
      ttlMs: options?.ttlMs,
    })

    return {
      ...result,
      freshness: "live" as const,
    }
  }
}

function cacheKey(query: string, limit: number): string {
  return `${query.trim().toLowerCase()}:${limit}`
}

/**
 * Serve the seed catalog as a fallback when Hugging Face is unavailable.
 * Returns candidates with "seed" freshness.
 */
export function seedFallback(seedCandidates: readonly ModelCandidate[]): CatalogSearchResult & { freshness: CatalogFreshness } {
  return {
    query: "",
    candidates: seedCandidates.map((c) => ({
      ...c,
      provenance: {
        ...c.provenance,
        freshness: "seed" as const,
      },
    })),
    freshness: "seed" as const,
  }
}
