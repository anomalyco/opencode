import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "fs/promises"
import path from "path"
import os from "os"
import { ConcurrencyCache } from "../../../src/provider/sdk/featherless/concurrency-cache"

interface FakeFetchOptions {
  status?: number
  body?: unknown
  delayMs?: number
  fail?: Error
}

interface FetchCall {
  url: string
  authorization: string | undefined
}

const buildFakeFetch = () => {
  const calls: FetchCall[] = []
  let next: FakeFetchOptions = { status: 200, body: { data: [] } }
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url, authorization: headers.get("authorization") ?? undefined })
    if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs))
    if (next.fail) throw next.fail
    return new Response(JSON.stringify(next.body ?? { data: [] }), { status: next.status ?? 200 })
  }) as unknown as typeof fetch
  return {
    calls,
    setNext: (opts: FakeFetchOptions) => {
      next = opts
    },
    impl: fetchImpl,
  }
}

const sampleResponse = (
  entries: Array<{ id: string; concurrency_cost?: number }> = [
    { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", concurrency_cost: 1 },
    { id: "meta-llama/Llama-3.3-70B-Instruct", concurrency_cost: 4 },
    { id: "moonshotai/Kimi-Linear-48B-A3B-Instruct", concurrency_cost: 3 },
  ],
) => ({ data: entries })

let tmpDir: string
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "featherless-cache-"))
})
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const make = (overrides: Partial<ConstructorParameters<typeof ConcurrencyCache>[0]> = {}) =>
  new ConcurrencyCache({
    apiKey: "test-key",
    cacheDir: tmpDir,
    ...overrides,
  })

describe("ConcurrencyCache", () => {
  it("constructor rejects empty apiKey", () => {
    expect(() => new ConcurrencyCache({ apiKey: "", cacheDir: tmpDir })).toThrow(/apiKey/)
  })

  it("getCost fetches when no disk cache exists, then serves from memory", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl })

    expect(await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")).toBe(1)
    expect(await cache.getCost("meta-llama/Llama-3.3-70B-Instruct")).toBe(4)
    expect(fetch.calls.length).toBe(1)
    expect(fetch.calls[0].url).toBe("https://api.featherless.ai/v1/models")
    expect(fetch.calls[0].authorization).toBe("Bearer test-key")
  })

  it("writes a slim {fetchedAt, costs} file to disk after a successful fetch", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl })
    await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")

    const text = await readFile(path.join(tmpDir, "featherless-models.json"), "utf-8")
    const parsed = JSON.parse(text)
    expect(typeof parsed.fetchedAt).toBe("number")
    expect(parsed.costs["meta-llama/Meta-Llama-3.1-8B-Instruct"]).toBe(1)
    expect(parsed.costs["meta-llama/Llama-3.3-70B-Instruct"]).toBe(4)
    expect(parsed.costs["moonshotai/Kimi-Linear-48B-A3B-Instruct"]).toBe(3)
  })

  it("loads from disk on first call when cache file is fresh, no fetch", async () => {
    const file = path.join(tmpDir, "featherless-models.json")
    await mkdir(tmpDir, { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ fetchedAt: Date.now(), costs: { "preexisting/model": 2 } }),
    )

    const fetch = buildFakeFetch()
    const cache = make({ fetch: fetch.impl })
    expect(await cache.getCost("preexisting/model")).toBe(2)
    expect(fetch.calls.length).toBe(0)
  })

  it("treats stale on-disk cache as usable, kicks off background refresh", async () => {
    const file = path.join(tmpDir, "featherless-models.json")
    const stale = Date.now() - 10 * 60 * 1000 // 10 min old, TTL is 5 min
    await mkdir(tmpDir, { recursive: true })
    await writeFile(file, JSON.stringify({ fetchedAt: stale, costs: { "old/model": 1 } }))

    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse([{ id: "old/model", concurrency_cost: 4 }]) })
    const cache = make({ fetch: fetch.impl })

    // First call returns stale value, but triggers a background refresh.
    expect(await cache.getCost("old/model")).toBe(1)

    // Wait for the in-flight refresh to settle.
    await Bun.sleep(20)
    expect(fetch.calls.length).toBe(1)
    // Subsequent call now sees the refreshed value.
    expect(await cache.getCost("old/model")).toBe(4)
  })

  it("ignores corrupt JSON on disk and refetches", async () => {
    const file = path.join(tmpDir, "featherless-models.json")
    await mkdir(tmpDir, { recursive: true })
    await writeFile(file, "not json {{{")

    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl })
    expect(await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")).toBe(1)
    expect(fetch.calls.length).toBe(1)
  })

  it("ignores cache file with wrong shape and refetches", async () => {
    const file = path.join(tmpDir, "featherless-models.json")
    await mkdir(tmpDir, { recursive: true })
    await writeFile(file, JSON.stringify({ wrong: "shape" }))

    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl })
    expect(await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")).toBe(1)
    expect(fetch.calls.length).toBe(1)
  })

  it("dedupes duplicate ids: last-write-wins", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({
      status: 200,
      body: sampleResponse([
        { id: "dup/model", concurrency_cost: 1 },
        { id: "dup/model", concurrency_cost: 4 }, // later entry wins
      ]),
    })
    const cache = make({ fetch: fetch.impl })
    expect(await cache.getCost("dup/model")).toBe(4)
    expect(cache.size()).toBe(1)
  })

  it("skips entries missing concurrency_cost without throwing", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({
      status: 200,
      body: sampleResponse([
        { id: "good/model", concurrency_cost: 1 },
        { id: "bad/model" }, // missing concurrency_cost
      ]),
    })
    const cache = make({ fetch: fetch.impl })
    expect(await cache.getCost("good/model")).toBe(1)
    // Now lookup the missing one — triggers ONE retry refresh, then falls back.
    expect(await cache.getCost("bad/model")).toBe(1) // fallback
    expect(fetch.calls.length).toBe(2)
  })

  it("falls back to costFallback (configurable) on persistent miss", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({
      status: 200,
      body: sampleResponse([{ id: "known/model", concurrency_cost: 2 }]),
    })
    const cache = make({ fetch: fetch.impl, costFallback: 7 })
    expect(await cache.getCost("unknown/model")).toBe(7)
  })

  it("single-flights concurrent refresh() calls", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse(), delayMs: 50 })
    const cache = make({ fetch: fetch.impl })

    const results = await Promise.all([
      cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct"),
      cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct"),
      cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct"),
      cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct"),
    ])
    expect(results).toEqual([1, 1, 1, 1])
    expect(fetch.calls.length).toBe(1)
  })

  it("invalidate() clears memory and disk, forcing next call to refetch", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl })

    expect(await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")).toBe(1)
    expect(fetch.calls.length).toBe(1)

    await cache.invalidate()
    await expect(stat(path.join(tmpDir, "featherless-models.json"))).rejects.toThrow()

    fetch.setNext({
      status: 200,
      body: sampleResponse([{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct", concurrency_cost: 4 }]),
    })
    expect(await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")).toBe(4)
    expect(fetch.calls.length).toBe(2)
  })

  it("on fetch error with no existing cache, falls back and does not crash", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ fail: new Error("network down") })
    const cache = make({ fetch: fetch.impl })
    // No cache + fetch fails → memory stays empty → fallback is returned.
    // Per current implementation: getCost calls ensureLoaded → blocking refresh
    // (which swallows the error and leaves memory undefined), then a single
    // foreground retry, then fallback.
    expect(await cache.getCost("any/model")).toBe(1)
  })

  it("on fetch error with existing fresh cache, keeps cache intact", async () => {
    const file = path.join(tmpDir, "featherless-models.json")
    await mkdir(tmpDir, { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ fetchedAt: Date.now(), costs: { "stable/model": 2 } }),
    )
    const fetch = buildFakeFetch()
    const cache = make({ fetch: fetch.impl })

    // Loads from disk, no fetch.
    expect(await cache.getCost("stable/model")).toBe(2)

    // Force a refresh that will fail. Cache should stay intact.
    fetch.setNext({ fail: new Error("transient") })
    await cache.refresh(true)
    expect(await cache.getCost("stable/model")).toBe(2)
  })

  it("respects custom baseURL", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 200, body: sampleResponse() })
    const cache = make({ fetch: fetch.impl, baseURL: "https://example.test/v1/" })
    await cache.getCost("meta-llama/Meta-Llama-3.1-8B-Instruct")
    expect(fetch.calls[0].url).toBe("https://example.test/v1/models")
  })

  it("non-2xx response is treated as failure, no cache write", async () => {
    const fetch = buildFakeFetch()
    fetch.setNext({ status: 401, body: { error: "unauthorized" } })
    const cache = make({ fetch: fetch.impl })
    // First call: blocking refresh fails → memory empty → retry → also fails
    // → fallback.
    expect(await cache.getCost("any/model")).toBe(1)
    await expect(stat(path.join(tmpDir, "featherless-models.json"))).rejects.toThrow()
  })
})
