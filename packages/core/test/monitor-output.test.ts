import { describe, expect, test } from "bun:test"
import { MonitorOutput } from "@opencode/core/monitor/output"

describe("MonitorOutput", () => {
  test("preserves multibyte text split across chunks and normalizes line endings", () => {
    const output = MonitorOutput.make()
    const bytes = new TextEncoder().encode("first\r\n🟢 ready\ntrailing\r")
    output.write(bytes.subarray(0, 9))
    expect(output.take()).toEqual([["first"]])
    output.write(bytes.subarray(9))
    expect(output.take()).toEqual([["🟢 ready"]])
    expect(output.take(true)).toEqual([["trailing"]])
    expect(output.take(true)).toEqual([])
  })

  test("splits a burst into byte-bounded events without dropping lines", () => {
    const output = MonitorOutput.make()
    const lines = Array.from({ length: 5 }, (_, index) => `${index}${"x".repeat(8_000)}`)
    output.write(new TextEncoder().encode(`${lines.join("\n")}\n`))
    const batches = output.take()
    expect(batches.flat()).toEqual(lines)
    expect(batches).toHaveLength(3)
    for (const batch of batches)
      expect(Buffer.byteLength(`${batch.join("\n")}\n`)).toBeLessThanOrEqual(MonitorOutput.EVENT_BYTES)
  })

  test("caps cumulative output even when previous events have been consumed", () => {
    const output = MonitorOutput.make()
    const bytes = new TextEncoder().encode(`${"x".repeat(MonitorOutput.EVENT_BYTES - 1)}\n`)
    for (let index = 0; index < MonitorOutput.MAX_BYTES / bytes.length; index++) {
      output.write(bytes)
      expect(output.take()).toHaveLength(1)
    }
    expect(output.bytes).toBe(MonitorOutput.MAX_BYTES)
    expect(output.exceeded).toBe(false)
    output.write(new TextEncoder().encode("one more\n"))
    expect(output.exceeded).toBe(true)
    expect(output.bytes).toBe(MonitorOutput.MAX_BYTES)
    expect(output.take(true)).toEqual([])
  })

  test("rejects an oversized line while retaining preceding complete lines", () => {
    const output = MonitorOutput.make()
    output.write(new TextEncoder().encode(`safe\n${"x".repeat(MonitorOutput.EVENT_BYTES)}\nignored\n`))
    expect(output.exceeded).toBe(true)
    expect(output.take(true)).toEqual([["safe"]])
  })

  test("bounds the replacement character from an incomplete final UTF-8 sequence", () => {
    const output = MonitorOutput.make()
    const bytes = new Uint8Array(MonitorOutput.EVENT_BYTES - 2)
    bytes.fill(120)
    bytes[bytes.length - 1] = 0xf0
    output.write(bytes)
    expect(output.exceeded).toBe(false)
    expect(output.take(true)).toEqual([])
    expect(output.exceeded).toBe(true)
  })
})
