import { describe, expect, test } from "bun:test"
import { cacheHighlights } from "../../src/util/syntax-highlight-cache"

describe("syntax highlight cache", () => {
  test("reuses completed and in-flight highlights", async () => {
    let calls = 0
    const highlight = cacheHighlights(async () => {
      calls++
      return { highlights: [[0, 5, "keyword"]] }
    })

    const first = highlight("const", "typescript")
    const second = highlight("const", "typescript")

    expect(second).toBe(first)
    expect(await second).toEqual({ highlights: [[0, 5, "keyword"]] })
    expect(await highlight("const", "typescript")).toEqual({ highlights: [[0, 5, "keyword"]] })
    expect(calls).toBe(1)
  })

  test("evicts least recently used highlights", async () => {
    let calls = 0
    const highlight = cacheHighlights(async () => {
      calls++
      return { highlights: [] }
    }, 2)

    await highlight("one", "text")
    await highlight("two", "text")
    await highlight("one", "text")
    await highlight("three", "text")
    await highlight("two", "text")

    expect(calls).toBe(4)
  })

  test("retries failed highlights", async () => {
    let calls = 0
    const highlight = cacheHighlights(async () => {
      calls++
      if (calls === 1) return { error: "parser unavailable" }
      return { highlights: [] }
    })

    await highlight("const", "typescript")
    await highlight("const", "typescript")

    expect(calls).toBe(2)
  })

  test("an evicted failure does not delete its replacement", async () => {
    const pending = Promise.withResolvers<{ highlights: [] }>()
    let calls = 0
    const highlight = cacheHighlights(() => {
      calls++
      if (calls === 1) return pending.promise
      return Promise.resolve({ highlights: [] })
    }, 1)

    const stale = highlight("one", "text")
    await highlight("two", "text")
    const current = highlight("one", "text")
    pending.reject(new Error("parser unavailable"))

    await expect(stale).rejects.toThrow("parser unavailable")
    expect(highlight("one", "text")).toBe(current)
    expect(calls).toBe(3)
  })
})
