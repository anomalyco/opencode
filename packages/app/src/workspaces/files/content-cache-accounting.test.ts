import { describe, expect, test } from "bun:test"
import { createFileContentCache } from "./content-cache"

const chunk = 8 * 1024 * 1024

describe("file content eviction", () => {
  test("evicts by entry cap using LRU order", () => {
    const cache = createFileContentCache()
    Array.from({ length: 41 }, (_, n) => cache.touch(`f-${n}`, 1))

    expect(cache.evict()).toEqual(["f-0"])
    expect(cache.evict()).toEqual([])
  })

  test("evicts by byte cap while preserving protected entries", () => {
    const cache = createFileContentCache()
    cache.touch("a", chunk)
    cache.touch("b", chunk)
    cache.touch("c", chunk)

    expect(cache.evict(new Set(["a"]))).toEqual(["b"])
    expect(cache.evict(new Set(["a"]))).toEqual([])
  })

  // Protecting files that hold no content (an unloaded active tab) used to end the pass before it evicted anything.
  test("evicts past protected paths the cache does not hold", () => {
    const cache = createFileContentCache()
    cache.touch("a", chunk * 2)
    cache.touch("b", chunk)

    expect(cache.evict(new Set(["a", "unloaded-1", "unloaded-2"]))).toEqual(["b"])
  })

  test("stops after one pass when only protected entries remain over budget", () => {
    const cache = createFileContentCache()
    cache.touch("a", chunk * 3)

    expect(cache.evict(new Set(["a"]))).toEqual([])
  })

  // The byte cap is 20 MiB, so each step shows the running total through what it evicts.
  test("accounts for overwrites, byte-preserving touches, removals, and resets", () => {
    const cache = createFileContentCache()
    cache.touch("a", chunk)
    cache.touch("b", chunk)
    cache.touch("a", 1)
    cache.touch("c", chunk)
    expect(cache.evict()).toEqual([])

    cache.touch("b")
    cache.touch("d", chunk)
    expect(cache.evict()).toEqual(["a", "c"])

    cache.remove("b")
    cache.touch("e", chunk)
    expect(cache.evict()).toEqual([])

    cache.reset()
    cache.touch("f", chunk)
    cache.touch("g", chunk)
    expect(cache.evict()).toEqual([])
  })

  // Every file provider (session, new session, components lab) used to share one cache, so one provider's directory
  // change wiped the others' accounting and left their content unevictable.
  test("keeps each provider's accounting separate", () => {
    const first = createFileContentCache()
    const second = createFileContentCache()
    first.touch("a", chunk)
    first.touch("b", chunk)
    second.touch("x", chunk)

    second.reset()
    first.touch("c", chunk)

    expect(first.evict()).toEqual(["a"])
    expect(second.evict()).toEqual([])
  })
})
