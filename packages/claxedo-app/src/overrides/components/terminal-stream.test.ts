import { describe, expect, test } from "bun:test"
import { createStream, pushStream, takeStream } from "./terminal-stream"

describe("terminal stream", () => {
  test("pushStream trims single oversized chunk to max bytes", () => {
    const stream = createStream()
    pushStream(stream, "a".repeat(10), 4)
    expect(stream.items).toEqual(["aaaa"])
    expect(stream.bytes).toBe(4)
    expect(stream.dropped).toBe(1)
  })

  test("pushStream caps backlog by dropping oldest chunks", () => {
    const stream = createStream()
    pushStream(stream, "aaaa", 6)
    pushStream(stream, "bbbb", 6)
    pushStream(stream, "cccc", 6)
    expect(stream.items).toEqual(["cccc"])
    expect(stream.bytes).toBe(4)
    expect(stream.dropped).toBe(2)
  })

  test("takeStream batches by bytes and item limits", () => {
    const stream = createStream()
    pushStream(stream, "aa", 100)
    pushStream(stream, "bb", 100)
    pushStream(stream, "cc", 100)

    const out1 = takeStream(stream, 4, 10)
    expect(out1).toBe("aabb")
    expect(stream.items).toEqual(["cc"])

    const out2 = takeStream(stream, 10, 1)
    expect(out2).toBe("cc")
    expect(stream.items).toEqual([])
  })
})
