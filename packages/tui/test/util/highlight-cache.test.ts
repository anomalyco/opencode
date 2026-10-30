import { describe, expect, test } from "bun:test"
import { createHighlightCache } from "../../src/util/highlight-cache"

function worker() {
  const calls: string[] = []
  const highlightOnce = (content: string, filetype: string) => {
    calls.push(`${filetype}:${content}`)
    if (content === "fail") return Promise.reject(new Error("worker failed"))
    return Promise.resolve({ highlights: [[0, content.length, "string"] as [number, number, string]] })
  }
  return { calls, highlightOnce }
}

describe("createHighlightCache", () => {
  test("answers the same text and language from the first result", async () => {
    const fake = worker()
    const highlight = createHighlightCache(fake.highlightOnce)
    const first = highlight("echo hi", "bash")
    const second = highlight("echo hi", "bash")
    expect(second).toBe(first)
    expect(await second).toEqual({ highlights: [[0, 7, "string"]] })
    expect(fake.calls).toEqual(["bash:echo hi"])
  })

  test("keys by language as well as content", async () => {
    const fake = worker()
    const highlight = createHighlightCache(fake.highlightOnce)
    await highlight("x = 1", "bash")
    await highlight("x = 1", "python")
    expect(fake.calls).toEqual(["bash:x = 1", "python:x = 1"])
  })

  test("drops the least recently used entry past the entry limit", async () => {
    const fake = worker()
    const highlight = createHighlightCache(fake.highlightOnce, { entries: 2, chars: 1000 })
    await highlight("a", "bash")
    await highlight("b", "bash")
    await highlight("a", "bash")
    await highlight("c", "bash")
    await highlight("a", "bash")
    await highlight("b", "bash")
    expect(fake.calls).toEqual(["bash:a", "bash:b", "bash:c", "bash:b"])
  })

  test("drops entries past the character budget", async () => {
    const fake = worker()
    const highlight = createHighlightCache(fake.highlightOnce, { entries: 100, chars: 5 })
    await highlight("aaa", "bash")
    await highlight("bbb", "bash")
    await highlight("aaa", "bash")
    expect(fake.calls).toEqual(["bash:aaa", "bash:bbb", "bash:aaa"])
  })

  test("asks the worker again after a failed request", async () => {
    const fake = worker()
    const highlight = createHighlightCache(fake.highlightOnce)
    await expect(highlight("fail", "bash")).rejects.toThrow("worker failed")
    await expect(highlight("fail", "bash")).rejects.toThrow("worker failed")
    expect(fake.calls).toEqual(["bash:fail", "bash:fail"])
  })
})
