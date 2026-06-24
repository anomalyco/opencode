import { describe, it, expect } from "bun:test"
import { InputHandler, type InputEvent } from "@/terminal/input/InputHandler"

function collect(handler: InputHandler, data: string, timeoutMs = 100): InputEvent[] {
  const events: InputEvent[] = []
  handler.on((e) => events.push(e))
  handler.feed(data)
  return events
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe("InputHandler", () => {
  it("emits CHAR and KEY for regular ASCII", () => {
    const h = new InputHandler()
    const events = collect(h, "a")
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: "CHAR", char: "a" })
    expect(events[1]).toEqual({ type: "KEY", key: "a" })
  })

  it("emits CHAR and KEY for space", () => {
    const h = new InputHandler()
    const events = collect(h, " ")
    expect(events[0]).toEqual({ type: "CHAR", char: " " })
    expect(events[1]).toEqual({ type: "KEY", key: " " })
  })

  it("emits KEY for enter", () => {
    const h = new InputHandler()
    const events = collect(h, "\r")
    expect(events[0]).toEqual({ type: "KEY", key: "\r" })
  })

  it("emits KEY for backspace", () => {
    const h = new InputHandler()
    const events = collect(h, "\x7f")
    expect(events[0]).toEqual({ type: "KEY", key: "\x7f" })
  })

  it("parses ArrowUp CSI sequence", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[A")
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "KEY", key: "ArrowUp" })
  })

  it("parses ArrowDown CSI sequence", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[B")
    expect(events[0]).toEqual({ type: "KEY", key: "ArrowDown" })
  })

  it("parses ArrowRight CSI sequence", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[C")
    expect(events[0]).toEqual({ type: "KEY", key: "ArrowRight" })
  })

  it("parses ArrowLeft CSI sequence", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[D")
    expect(events[0]).toEqual({ type: "KEY", key: "ArrowLeft" })
  })

  it("parses Home and End", () => {
    const h = new InputHandler()
    expect(collect(h, "\x1b[H")[0]).toEqual({ type: "KEY", key: "Home" })
    expect(collect(h, "\x1b[F")[0]).toEqual({ type: "KEY", key: "End" })
    expect(collect(h, "\x1b[1~")[0]).toEqual({ type: "KEY", key: "Home" })
    expect(collect(h, "\x1b[4~")[0]).toEqual({ type: "KEY", key: "End" })
  })

  it("parses Insert and Delete", () => {
    const h = new InputHandler()
    expect(collect(h, "\x1b[2~")[0]).toEqual({ type: "KEY", key: "Insert" })
    expect(collect(h, "\x1b[3~")[0]).toEqual({ type: "KEY", key: "Delete" })
  })

  it("parses PageUp and PageDown", () => {
    const h = new InputHandler()
    expect(collect(h, "\x1b[5~")[0]).toEqual({ type: "KEY", key: "PageUp" })
    expect(collect(h, "\x1b[6~")[0]).toEqual({ type: "KEY", key: "PageDown" })
  })

  it("parses bracketed paste events", () => {
    const h = new InputHandler()
    expect(collect(h, "\x1b[200~")[0]).toEqual({ type: "PASTE_START" })
    expect(collect(h, "\x1b[201~")[0]).toEqual({ type: "PASTE_END" })
  })

  it("parses focus events", () => {
    const h = new InputHandler()
    expect(collect(h, "\x1b[I")[0]).toEqual({ type: "FOCUS_IN" })
    expect(collect(h, "\x1b[O")[0]).toEqual({ type: "FOCUS_OUT" })
  })

  it("parses SGR mouse press", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[<0;10;20M")
    expect(events[0]).toEqual({ type: "MOUSE", button: 0, x: 9, y: 19, release: false })
  })

  it("parses SGR mouse release", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[<0;10;20m")
    expect(events[0]).toEqual({ type: "MOUSE", button: 0, x: 9, y: 19, release: true })
  })

  it("emits Escape after timeout", async () => {
    const h = new InputHandler()
    const events: InputEvent[] = []
    h.on((e) => events.push(e))
    h.feed("\x1b")
    expect(events).toHaveLength(0)
    await wait(60)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "KEY", key: "Escape" })
  })

  it("does not emit Escape when ESC starts a CSI sequence", async () => {
    const h = new InputHandler()
    const events: InputEvent[] = []
    h.on((e) => events.push(e))
    h.feed("\x1b[A")
    await wait(60)
    const hasEscape = events.some((e) => e.type === "KEY" && e.key === "Escape")
    expect(hasEscape).toBe(false)
    expect(events.some((e) => e.type === "KEY" && e.key === "ArrowUp")).toBe(true)
  })

  it("parses Alt+letter", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1ba")
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "KEY", key: "Alt+a" })
  })

  it("parses multiple characters in sequence", () => {
    const h = new InputHandler()
    const events = collect(h, "hello")
    expect(events.length).toBeGreaterThanOrEqual(5)
  })

  it("parses Ctrl+A through Ctrl+Z", () => {
    for (let i = 1; i <= 26; i++) {
      const h = new InputHandler()
      const ch = String.fromCharCode(i)
      const events = collect(h, ch)
      const ev = events[0]
      if (ev?.type === "KEY") {
        expect(ev.key).toBe(ch)
      } else {
        expect(ev).toBeTruthy()
      }
    }
  })

  it("on returns unsubscribe function", () => {
    const h = new InputHandler()
    const events: InputEvent[] = []
    const unsub = h.on((e) => events.push(e))
    unsub()
    h.feed("a")
    expect(events).toHaveLength(0)
  })

  it("feed is idempotent without attach", () => {
    const h = new InputHandler()
    const events = collect(h, "\x1b[A")
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: "KEY", key: "ArrowUp" })
  })
})
