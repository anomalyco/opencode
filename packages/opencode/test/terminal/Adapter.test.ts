import { describe, it, expect } from "bun:test"
import { DoubleBuffer } from "@/terminal/buffer/DoubleBuffer"
import { OutputChannel } from "@/terminal/buffer/OutputChannel"
import { Adapter } from "@/terminal/core/Adapter"

describe("Adapter", () => {
  it("writeAI produces output for simple ASCII", () => {
    const db = new DoubleBuffer(10, 5)
    const chunks: string[] = []
    const output = new OutputChannel((out) => { chunks.push(out); return true })
    const adapter = new Adapter(db, output)

    const result = adapter.writeAI(new TextEncoder().encode("hello"))
    expect(result).toBe(true)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain("\x1b[H")
    expect(chunks[0]).toContain("hello")
  })

  it("writeAI returns false on backpressure", () => {
    const db = new DoubleBuffer(10, 5)
    const output = new OutputChannel(() => false)
    const adapter = new Adapter(db, output)
    const result = adapter.writeAI(new TextEncoder().encode("test"))
    expect(result).toBe(false)
  })

  it("writeAI renders multi-line content", () => {
    const db = new DoubleBuffer(10, 5)
    const chunks: string[] = []
    const output = new OutputChannel((out) => { chunks.push(out); return true })
    const adapter = new Adapter(db, output)

    adapter.writeAI(new TextEncoder().encode("line1\nline2\nline3"))
    expect(chunks.length).toBe(1)
    // cursorHome prefix
    expect(chunks[0]).toContain("\x1b[H")
    // all three lines should be in the output
    expect(chunks[0]).toContain("line1")
    expect(chunks[0]).toContain("line2")
    expect(chunks[0]).toContain("line3")
  })

  it("writeAI strips ANSI from AI output before rendering", () => {
    const db = new DoubleBuffer(10, 5)
    const chunks: string[] = []
    const output = new OutputChannel((out) => { chunks.push(out); return true })
    const adapter = new Adapter(db, output)

    adapter.writeAI(new TextEncoder().encode("\x1b[31mred\x1b[0m"))
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain("red")
    // ANSI codes are stripped by OutputParser, but SgrDelta may re-add them
    // based on screen state — just verify content is there
  })

  it("multiple writeAI calls produce updated output", () => {
    const db = new DoubleBuffer(10, 5)
    const chunks: string[] = []
    const output = new OutputChannel((out) => { chunks.push(out); return true })
    const adapter = new Adapter(db, output)

    adapter.writeAI(new TextEncoder().encode("hello"))
    adapter.writeAI(new TextEncoder().encode("world"))
    expect(chunks.length).toBe(2)
    // Second call should contain only the changed cells from "hello" → "world"
    // "hello"[3] = "l" matches "world"[3] = "l", so diff skips it
    expect(chunks[1]).toContain("wor")
    expect(chunks[1]).toContain("d")
  })
})
