import { describe, expect, test } from "bun:test"
import { PtyProtocol } from "@opencode/core/pty/protocol"

describe("pty protocol", () => {
  test("drops invalid binary input frames and decodes valid ones", () => {
    expect(PtyProtocol.decodeInput("ready")).toBe("ready")
    expect(PtyProtocol.decodeInput(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeUndefined()
    expect(PtyProtocol.decodeInput(new TextEncoder().encode("hello"))).toBe("hello")
    expect(PtyProtocol.decodeInput(new TextEncoder().encode("hello").buffer)).toBe("hello")
  })

  test("encodes the cursor as a 0x00-prefixed JSON control frame", () => {
    const frame = PtyProtocol.metaFrame(42)
    expect(frame[0]).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(frame.subarray(1)))).toEqual({ cursor: 42 })
  })

  test("splits replay into bounded frames", () => {
    expect(PtyProtocol.chunks("")).toEqual([])
    expect(PtyProtocol.chunks("abc")).toEqual(["abc"])
    const big = "x".repeat(PtyProtocol.REPLAY_CHUNK + 1)
    const frames = PtyProtocol.chunks(big)
    expect(frames.length).toBe(2)
    expect(frames[0].length).toBe(PtyProtocol.REPLAY_CHUNK)
    expect(frames.join("")).toBe(big)
  })

  test("keeps both halves of a surrogate pair in one frame", () => {
    // Frames travel as UTF-8, where a lone surrogate encodes as U+FFFD. Here the emoji straddles the
    // first chunk boundary, because the prefix is one UTF-16 unit short of it.
    const data = `${"a".repeat(PtyProtocol.REPLAY_CHUNK - 1)}😀${"b".repeat(8)}`
    const decode = (value: string) => new TextDecoder().decode(new TextEncoder().encode(value))
    const frames = PtyProtocol.chunks(data)
    expect(frames.length).toBe(2)
    expect(frames.join("")).toBe(data)
    for (const frame of frames) expect(decode(frame)).toBe(frame)
  })
})
