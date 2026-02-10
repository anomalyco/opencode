import { describe, expect, test, vi } from "bun:test"
import { setupKeyboardHandler } from "./helpers"

function key(input: { key: string; metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) {
  let prevented = false
  let stopped = false
  const event = {
    type: "keydown",
    key: input.key,
    metaKey: !!input.metaKey,
    shiftKey: !!input.shiftKey,
    ctrlKey: !!input.ctrlKey,
    altKey: !!input.altKey,
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: () => {
      stopped = true
    },
  } as unknown as KeyboardEvent
  return {
    event,
    prevented: () => prevented,
    stopped: () => stopped,
  }
}

function xterm() {
  const state = { fn: ((_: KeyboardEvent) => true) as (event: KeyboardEvent) => boolean }
  return {
    state,
    terminal: {
      attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
        state.fn = fn
      },
    },
  }
}

describe("setupKeyboardHandler split shortcuts", () => {
  test("Cmd+D intercepts and blocks bubbling", () => {
    const split = vi.fn()
    const term = xterm()
    setupKeyboardHandler(term.terminal as never, { onSplitVertical: split })
    const e = key({ key: "d", metaKey: true })
    const result = term.state.fn(e.event)

    expect(result).toBe(false)
    expect(split).toHaveBeenCalledTimes(1)
    expect(e.prevented()).toBe(true)
    expect(e.stopped()).toBe(true)
  })

  test("Cmd+Shift+D intercepts even when key is uppercase", () => {
    const split = vi.fn()
    const term = xterm()
    setupKeyboardHandler(term.terminal as never, { onSplitHorizontal: split })
    const e = key({ key: "D", metaKey: true, shiftKey: true })
    const result = term.state.fn(e.event)

    expect(result).toBe(false)
    expect(split).toHaveBeenCalledTimes(1)
    expect(e.prevented()).toBe(true)
    expect(e.stopped()).toBe(true)
  })

})
