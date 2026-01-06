import { describe, expect, test } from "bun:test"
import { LRUMap } from "../../src/util/lru-map"

describe("LRUMap", () => {
  test("basic get and set operations", () => {
    const map = new LRUMap<string, number>(10)
    map.set("a", 1)
    map.set("b", 2)
    expect(map.get("a")).toBe(1)
    expect(map.get("b")).toBe(2)
    expect(map.size).toBe(2)
  })

  test("has returns correct value", () => {
    const map = new LRUMap<string, number>(10)
    map.set("a", 1)
    expect(map.has("a")).toBe(true)
    expect(map.has("b")).toBe(false)
  })

  test("delete removes entry", () => {
    const map = new LRUMap<string, number>(10)
    map.set("a", 1)
    expect(map.has("a")).toBe(true)
    map.delete("a")
    expect(map.has("a")).toBe(false)
    expect(map.size).toBe(0)
  })

  test("evicts oldest entries when over capacity", () => {
    const map = new LRUMap<string, number>(3)
    map.set("a", 1)
    map.set("b", 2)
    map.set("c", 3)
    expect(map.size).toBe(3)

    // Adding a 4th entry should evict the oldest ("a")
    map.set("d", 4)
    expect(map.size).toBe(3)
    expect(map.has("a")).toBe(false)
    expect(map.has("b")).toBe(true)
    expect(map.has("c")).toBe(true)
    expect(map.has("d")).toBe(true)
  })

  test("get moves entry to end (most recently used)", () => {
    const map = new LRUMap<string, number>(3)
    map.set("a", 1)
    map.set("b", 2)
    map.set("c", 3)

    // Access "a" to make it most recently used
    map.get("a")

    // Adding "d" should now evict "b" (oldest after "a" was accessed)
    map.set("d", 4)
    expect(map.has("a")).toBe(true)
    expect(map.has("b")).toBe(false)
    expect(map.has("c")).toBe(true)
    expect(map.has("d")).toBe(true)
  })

  test("set updates value and moves to end", () => {
    const map = new LRUMap<string, number>(3)
    map.set("a", 1)
    map.set("b", 2)
    map.set("c", 3)

    // Update "a" to make it most recently used
    map.set("a", 100)
    expect(map.get("a")).toBe(100)

    // Adding "d" should evict "b"
    map.set("d", 4)
    expect(map.has("a")).toBe(true)
    expect(map.has("b")).toBe(false)
    expect(map.has("c")).toBe(true)
    expect(map.has("d")).toBe(true)
  })

  test("clear removes all entries", () => {
    const map = new LRUMap<string, number>(10)
    map.set("a", 1)
    map.set("b", 2)
    map.clear()
    expect(map.size).toBe(0)
    expect(map.has("a")).toBe(false)
  })

  test("iterators work correctly", () => {
    const map = new LRUMap<string, number>(10)
    map.set("a", 1)
    map.set("b", 2)

    expect([...map.keys()]).toEqual(["a", "b"])
    expect([...map.values()]).toEqual([1, 2])
    expect([...map.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
    ])
  })

  test("handles capacity of 1", () => {
    const map = new LRUMap<string, number>(1)
    map.set("a", 1)
    expect(map.get("a")).toBe(1)
    map.set("b", 2)
    expect(map.has("a")).toBe(false)
    expect(map.get("b")).toBe(2)
    expect(map.size).toBe(1)
  })

  test("handles falsy but valid values (0, false, empty string)", () => {
    // Test with 0
    const numMap = new LRUMap<string, number>(3)
    numMap.set("a", 0)
    numMap.set("b", 1)
    numMap.set("c", 2)
    expect(numMap.get("a")).toBe(0)

    // After accessing "a", it should be most recently used
    // Adding "d" should evict "b" (not "a")
    numMap.set("d", 3)
    expect(numMap.has("a")).toBe(true)
    expect(numMap.has("b")).toBe(false)

    // Test with false
    const boolMap = new LRUMap<string, boolean>(3)
    boolMap.set("a", false)
    boolMap.set("b", true)
    boolMap.set("c", true)
    expect(boolMap.get("a")).toBe(false)

    boolMap.set("d", true)
    expect(boolMap.has("a")).toBe(true)
    expect(boolMap.has("b")).toBe(false)

    // Test with empty string
    const strMap = new LRUMap<string, string>(3)
    strMap.set("a", "")
    strMap.set("b", "x")
    strMap.set("c", "y")
    expect(strMap.get("a")).toBe("")

    strMap.set("d", "z")
    expect(strMap.has("a")).toBe(true)
    expect(strMap.has("b")).toBe(false)
  })

  test("throws on invalid capacity values", () => {
    expect(() => new LRUMap<string, number>(0)).toThrow(RangeError)
    expect(() => new LRUMap<string, number>(-1)).toThrow(RangeError)
    expect(() => new LRUMap<string, number>(1.5)).toThrow(RangeError)
    expect(() => new LRUMap<string, number>(NaN)).toThrow(RangeError)
    expect(() => new LRUMap<string, number>(Infinity)).toThrow(RangeError)
  })

  test("handles large number of entries", () => {
    const capacity = 100
    const map = new LRUMap<number, number>(capacity)

    // Add more entries than capacity
    for (let i = 0; i < 200; i++) {
      map.set(i, i * 2)
    }

    expect(map.size).toBe(capacity)
    // First 100 entries should be evicted
    expect(map.has(0)).toBe(false)
    expect(map.has(99)).toBe(false)
    // Last 100 entries should remain
    expect(map.has(100)).toBe(true)
    expect(map.has(199)).toBe(true)
    expect(map.get(150)).toBe(300)
  })
})
