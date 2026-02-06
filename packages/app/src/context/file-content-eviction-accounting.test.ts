import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"

let evictContentLru: (keep: Set<string> | undefined, evict: (path: string) => void) => void
let getFileContentBytesTotal: () => number
let getFileContentEntryCount: () => number
let removeFileContentBytes: (path: string) => void
let resetFileContentLru: () => void
let setFileContentBytes: (path: string, bytes: number) => void
let touchFileContent: (path: string, bytes?: number) => void

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))

  const mod = await import("./file")
  evictContentLru = mod.evictContentLru
  getFileContentBytesTotal = mod.getFileContentBytesTotal
  getFileContentEntryCount = mod.getFileContentEntryCount
  removeFileContentBytes = mod.removeFileContentBytes
  resetFileContentLru = mod.resetFileContentLru
  setFileContentBytes = mod.setFileContentBytes
  touchFileContent = mod.touchFileContent
})

describe("file content eviction accounting", () => {
  afterEach(() => {
    resetFileContentLru()
  })

  test("updates byte totals incrementally for set, overwrite, remove, and reset", () => {
    setFileContentBytes("a", 10)
    setFileContentBytes("b", 15)
    expect(getFileContentBytesTotal()).toBe(25)
    expect(getFileContentEntryCount()).toBe(2)

    setFileContentBytes("a", 5)
    expect(getFileContentBytesTotal()).toBe(20)
    expect(getFileContentEntryCount()).toBe(2)

    touchFileContent("a")
    expect(getFileContentBytesTotal()).toBe(20)

    removeFileContentBytes("b")
    expect(getFileContentBytesTotal()).toBe(5)
    expect(getFileContentEntryCount()).toBe(1)

    resetFileContentLru()
    expect(getFileContentBytesTotal()).toBe(0)
    expect(getFileContentEntryCount()).toBe(0)
  })

  test("evicts by entry cap using LRU order", () => {
    for (const i of Array.from({ length: 41 }, (_, n) => n)) {
      setFileContentBytes(`f-${i}`, 1)
    }

    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))

    expect(evicted).toEqual(["f-0"])
    expect(getFileContentEntryCount()).toBe(40)
    expect(getFileContentBytesTotal()).toBe(40)
  })

  test("evicts by byte cap while preserving protected entries", () => {
    const chunk = 8 * 1024 * 1024
    setFileContentBytes("a", chunk)
    setFileContentBytes("b", chunk)
    setFileContentBytes("c", chunk)

    const evicted: string[] = []
    evictContentLru(new Set(["a"]), (path) => evicted.push(path))

    expect(evicted).toEqual(["b"])
    expect(getFileContentEntryCount()).toBe(2)
    expect(getFileContentBytesTotal()).toBe(chunk * 2)
  })
})
