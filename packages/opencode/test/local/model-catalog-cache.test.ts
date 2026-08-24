import { describe, expect, test } from "bun:test"
import { createCatalogCache, withCache, seedFallback } from "../../src/local/model-catalog/cache"
import type { CatalogSearchResult, ModelCandidate } from "../../src/local/model-catalog/types"

const makeResult = (candidates: ModelCandidate[] = []): CatalogSearchResult => ({
  query: "test",
  candidates,
})

const makeCandidate = (repository: string): ModelCandidate => ({
  id: repository,
  name: repository.split("/").at(-1) ?? repository,
  author: repository.split("/")[0] ?? null,
  repository,
  revision: "abc123def456",
  architecture: null,
  parameterCount: null,
  activeParameterCount: null,
  trainedContext: null,
  pipelineTag: null,
  capabilities: [],
  languages: [],
  license: "apache-2.0",
  downloads: 0,
  likes: 0,
  tags: [],
  variants: [],
  policy: {
    allowed: true,
    reasons: [],
  },
  provenance: {
    source: "seed",
    repository,
    freshness: "seed",
  },
})

describe("createCatalogCache", () => {
  test("starts empty", () => {
    const cache = createCatalogCache()
    expect(cache.get("key")).toEqual({ type: "miss" })
    expect(cache.size()).toBe(0)
  })

  test("stores and retrieves a cached entry", () => {
    const cache = createCatalogCache()
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })

    const hit = cache.get("key")
    expect(hit.type).toBe("fresh")
    expect(hit.entry?.result).toBe(result)
  })

  test("serves stale entry after TTL expires but within stale threshold", () => {
    let now = Date.now()
    const cache = createCatalogCache({
      ttlMs: 1000,
      staleThresholdMs: 5000,
      clock: () => now,
    })
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })

    // Advance past TTL
    now += 2000
    const hit = cache.get("key")
    expect(hit.type).toBe("stale")
    expect(hit.entry?.result).toBe(result)
  })

  test("evicts entry past TTL + stale threshold", () => {
    let now = Date.now()
    const cache = createCatalogCache({
      ttlMs: 1000,
      staleThresholdMs: 500,
      clock: () => now,
    })
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })

    // Advance past TTL + stale threshold
    now += 3000
    const hit = cache.get("key")
    expect(hit.type).toBe("miss")
    expect(cache.size()).toBe(0)
    expect(cache.stats.evictions).toBe(1)
  })

  test("invalidates by key", () => {
    const cache = createCatalogCache()
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })
    cache.invalidate("key")
    expect(cache.get("key")).toEqual({ type: "miss" })
  })

  test("invalidates by revision", () => {
    const cache = createCatalogCache()
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key1", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })
    cache.set("key2", {
      etag: "v1-test",
      revision: "def456",
      result,
    })

    cache.invalidateByRevision("abc123")
    expect(cache.get("key1")).toEqual({ type: "miss" })
    expect(cache.get("key2").type).toBe("fresh")
  })

  test("tracks stats correctly", () => {
    let now = Date.now()
    const cache = createCatalogCache({
      ttlMs: 1000,
      staleThresholdMs: 5000,
      clock: () => now,
    })
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    cache.set("key", {
      etag: "v1-test",
      revision: "abc123",
      result,
    })

    expect(cache.stats.hits).toBe(0)
    expect(cache.stats.misses).toBe(0)

    // Hit
    cache.get("key")
    expect(cache.stats.hits).toBe(1)

    // Miss
    cache.get("missing")
    expect(cache.stats.misses).toBe(1)

    // Stale hit
    now += 2000
    cache.get("key")
    expect(cache.stats.staleHits).toBe(1)
  })

  test("supports custom TTL per entry", () => {
    let now = Date.now()
    const cache = createCatalogCache({
      ttlMs: 60000,
      staleThresholdMs: 10000,
      clock: () => now,
    })
    const result = makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])

    // Short TTL entry
    cache.set("short", {
      etag: "v1-test",
      revision: "abc123",
      result,
      ttlMs: 500,
    })

    now += 600
    const hit = cache.get("short")
    expect(hit.type).toBe("stale") // Past TTL (500ms) but within stale window (500 + 10000 = 10500ms)
  })
})

describe("withCache", () => {
  test("fetches from fetcher on cache miss", async () => {
    let fetchCount = 0
    const cache = createCatalogCache()
    const fetcher = async (query: string, limit: number): Promise<CatalogSearchResult> => {
      fetchCount++
      return makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])
    }
    const cachedFetcher = withCache(fetcher, cache)

    const result = await cachedFetcher("qwen", 10)
    expect(fetchCount).toBe(1)
    expect(result.freshness).toBe("live")
  })

  test("serves from cache on subsequent calls", async () => {
    let fetchCount = 0
    const cache = createCatalogCache()
    const fetcher = async (query: string, limit: number): Promise<CatalogSearchResult> => {
      fetchCount++
      return makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])
    }
    const cachedFetcher = withCache(fetcher, cache)

    await cachedFetcher("qwen", 5)
    await cachedFetcher("qwen", 5)
    await cachedFetcher("qwen", 5)

    expect(fetchCount).toBe(1)
  })

  test("different queries produce separate cache entries", async () => {
    let fetchCount = 0
    const cache = createCatalogCache()
    const fetcher = async (query: string, limit: number): Promise<CatalogSearchResult> => {
      fetchCount++
      return makeResult([makeCandidate("Qwen/Qwen3-35B-A3B")])
    }
    const cachedFetcher = withCache(fetcher, cache)

    await cachedFetcher("qwen", 5)
    await cachedFetcher("llama", 5)
    await cachedFetcher("qwen", 10)

    expect(fetchCount).toBe(3)
  })
})

describe("seedFallback", () => {
  test("returns candidates with seed freshness", () => {
    const candidates = [makeCandidate("Qwen/Qwen3-35B-A3B")]
    const result = seedFallback(candidates)

    expect(result.candidates).toHaveLength(1)
    expect(result.freshness).toBe("seed")
    expect(result.candidates[0].provenance.freshness).toBe("seed")
  })
})
