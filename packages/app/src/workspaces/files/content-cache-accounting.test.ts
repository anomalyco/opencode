import { afterEach, describe, expect, test } from "bun:test"
import { evictContentLru, removeFileContentBytes, resetFileContentLru, touchFileContent } from "./content-cache"

const chunk = 8 * 1024 * 1024

function evict(keep?: Set<string>) {
  const evicted: string[] = []
  evictContentLru(keep, (path) => evicted.push(path))
  return evicted
}

describe("file content eviction", () => {
  afterEach(() => {
    resetFileContentLru()
  })

  test("evicts by entry cap using LRU order", () => {
    Array.from({ length: 41 }, (_, n) => touchFileContent(`f-${n}`, 1))

    expect(evict()).toEqual(["f-0"])
    expect(evict()).toEqual([])
  })

  test("evicts by byte cap while preserving protected entries", () => {
    touchFileContent("a", chunk)
    touchFileContent("b", chunk)
    touchFileContent("c", chunk)

    expect(evict(new Set(["a"]))).toEqual(["b"])
    expect(evict(new Set(["a"]))).toEqual([])
  })

  // The byte cap is 20 MiB, so each step shows the running total through what it evicts.
  test("accounts for overwrites, byte-preserving touches, removals, and resets", () => {
    touchFileContent("a", chunk)
    touchFileContent("b", chunk)
    touchFileContent("a", 1)
    touchFileContent("c", chunk)
    expect(evict()).toEqual([])

    touchFileContent("b")
    touchFileContent("d", chunk)
    expect(evict()).toEqual(["a", "c"])

    removeFileContentBytes("b")
    touchFileContent("e", chunk)
    expect(evict()).toEqual([])

    resetFileContentLru()
    touchFileContent("f", chunk)
    touchFileContent("g", chunk)
    expect(evict()).toEqual([])
  })
})
