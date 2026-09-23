import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Ghostty, Terminal } from "ghostty-web"

describe("terminal application mouse reporting", () => {
  let container: HTMLDivElement
  let terminal: Terminal
  let canvas: HTMLCanvasElement
  let data: string[]

  beforeEach(async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    terminal = new Terminal({ cols: 80, rows: 24, ghostty: await Ghostty.load() })
    terminal.open(container)
    terminal.write("\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1015h\x1b[?1006h")
    canvas = container.querySelector("canvas")!
    data = []
    terminal.onData((value) => data.push(value))
  })

  afterEach(() => {
    terminal.dispose()
    container.remove()
  })

  const wheel = (deltaX: number, deltaY: number) => {
    const event = new WheelEvent("wheel", { deltaX, deltaY, bubbles: true })
    Object.defineProperties(event, { clientX: { value: 40 }, clientY: { value: 30 } })
    canvas.dispatchEvent(event)
  }

  test("reports wheel input with its terminal coordinates instead of arrow keys", () => {
    wheel(0, -100)

    expect(data).toEqual(["\x1b[<64;6;3M"])
  })

  test("does not discard small trackpad deltas", () => {
    wheel(0, -1)

    expect(data).toEqual(["\x1b[<64;6;3M"])
  })

  test("reports horizontal scrolling", () => {
    wheel(100, 0)

    expect(data).toEqual(["\x1b[<67;6;3M"])
  })

  test("distinguishes pointer movement from a left-button drag", () => {
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 30, bubbles: true }))

    expect(data).toEqual(["\x1b[<35;6;3M"])
  })

  test("encodes Alt-modified clicks", () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { altKey: true, clientX: 40, clientY: 30, bubbles: true }))

    expect(data).toEqual(["\x1b[<8;6;3M"])
  })

  test("leaves application clicks available for process selection", () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: 40, clientY: 30, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent("mouseup", { clientX: 40, clientY: 30, bubbles: true }))

    expect(data).toEqual(["\x1b[<0;6;3M", "\x1b[<0;6;3m"])
  })

  test("preserves Shift as the terminal selection override", () => {
    canvas.dispatchEvent(new MouseEvent("mousedown", { shiftKey: true, clientX: 40, clientY: 30, bubbles: true }))

    expect(data).toEqual([])
  })
})
