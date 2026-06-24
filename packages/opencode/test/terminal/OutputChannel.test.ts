import { describe, it, expect } from "bun:test"
import { OutputChannel } from "@/terminal/buffer/OutputChannel"

describe("OutputChannel", () => {
  it("writes to custom sink", () => {
    const chunks: string[] = []
    const ch = new OutputChannel((out) => { chunks.push(out) })
    ch.write("hello")
    expect(chunks).toEqual(["hello"])
  })

  it("returns true when sink accepts", () => {
    const ch = new OutputChannel(() => true)
    expect(ch.write("ok")).toBe(true)
  })

  it("returns false and queues when sink returns false", () => {
    const ch = new OutputChannel(() => false)
    expect(ch.write("first")).toBe(false)
    expect(ch.queueLength).toBe(1)
  })

  it("queues subsequent writes during draining", () => {
    let callCount = 0
    const ch = new OutputChannel(() => { callCount++; return false })
    ch.write("a")
    ch.write("b")
    ch.write("c")
    expect(callCount).toBe(1)
    expect(ch.queueLength).toBe(3)
  })

  it("isDraining reflects state", () => {
    const ch = new OutputChannel(() => false)
    expect(ch.isDraining).toBe(false)
    ch.write("x")
    expect(ch.isDraining).toBe(true)
  })

  it("queueLength returns buffered count", () => {
    const ch = new OutputChannel(() => false)
    expect(ch.queueLength).toBe(0)
    ch.write("a")
    ch.write("b")
    expect(ch.queueLength).toBe(2)
  })

  it("start registers drain listener", () => {
    const ch = new OutputChannel(() => true)
    ch.start()
    expect(process.stdout.listenerCount("drain")).toBeGreaterThan(0)
    ch.stop()
  })

  it("stop removes drain listener", () => {
    const ch = new OutputChannel(() => true)
    ch.start()
    ch.stop()
    expect(process.stdout.listenerCount("drain")).toBe(0)
  })
})
