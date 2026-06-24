import { describe, it, expect } from "bun:test"
import { InputChannel } from "@/terminal/input/InputChannel"
import type { InputEvent } from "@/terminal/input/InputHandler"

describe("InputChannel", () => {
  it("feeds CHAR and KEY events to listener", () => {
    const ch = new InputChannel()
    const events: InputEvent[] = []
    ch.onEvent((evt) => events.push(evt))
    ch.feed("a")
    expect(events.length).toBe(2)
    expect(events[0]).toEqual({ type: "CHAR", char: "a" })
    expect(events[1]).toEqual({ type: "KEY", key: "a" })
  })

  it("does not emit after cleanup", () => {
    const ch = new InputChannel()
    const events: InputEvent[] = []
    const cleanup = ch.onEvent((evt) => events.push(evt))
    cleanup()
    ch.feed("x")
    expect(events.length).toBe(0)
  })

  it("buffers events when paused", () => {
    const ch = new InputChannel()
    const events: InputEvent[] = []
    ch.onEvent((evt) => events.push(evt))
    ch.pause()
    ch.feed("a")
    ch.feed("b")
    expect(events.length).toBe(0)
    ch.resume()
    expect(events.length).toBe(4)
  })

  it("resume flushes buffer in order", () => {
    const ch = new InputChannel()
    const keys: string[] = []
    ch.onEvent((evt) => { if (evt.type === "KEY") keys.push(evt.key) })
    ch.pause()
    ch.feed("ab")
    ch.resume()
    expect(keys).toEqual(["a", "b"])
  })

  it("stop clears buffer", () => {
    const ch = new InputChannel()
    ch.pause()
    ch.feed("x")
    ch.stop()
    const events: InputEvent[] = []
    ch.onEvent((evt) => events.push(evt))
    ch.resume()
    expect(events.length).toBe(0)
  })

  it("isPaused reflects state", () => {
    const ch = new InputChannel()
    expect(ch.isPaused).toBe(false)
    ch.pause()
    expect(ch.isPaused).toBe(true)
    ch.resume()
    expect(ch.isPaused).toBe(false)
  })

  it("handles multiple listeners correctly", () => {
    const ch = new InputChannel()
    const a: InputEvent[] = []
    const b: InputEvent[] = []
    const cleanupA = ch.onEvent((evt) => a.push(evt))
    ch.onEvent((evt) => b.push(evt))
    ch.feed("z")
    expect(a.length).toBe(2)
    expect(b.length).toBe(2)
    cleanupA()
    ch.feed("y")
    expect(a.length).toBe(2)
    expect(b.length).toBe(4)
  })
})
