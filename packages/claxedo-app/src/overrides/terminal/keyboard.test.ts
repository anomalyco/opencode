import { describe, expect, test, vi } from "bun:test"
import { setupKeyboardHandler } from "./helpers"

// ---------------------------------------------------------------------------
// Factories (same pattern as helpers.test.ts)
// ---------------------------------------------------------------------------

function key(input: {
  key: string
  type?: string
  metaKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}) {
  let prevented = false
  let stopped = false
  const event = {
    type: input.type ?? "keydown",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupKeyboardHandler", () => {
  // Shift+Enter
  describe("Shift+Enter", () => {
    test("calls onShiftEnter on keydown", () => {
      const onShiftEnter = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onShiftEnter })
      const e = key({ key: "Enter", shiftKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
      expect(onShiftEnter).toHaveBeenCalledTimes(1)
    })

    test("does not call onShiftEnter on keyup", () => {
      const onShiftEnter = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onShiftEnter })
      const e = key({ key: "Enter", shiftKey: true, type: "keyup" })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
      expect(onShiftEnter).not.toHaveBeenCalled()
    })
  })

  // Ctrl+Backspace (non-Mac / default test env)
  describe("Ctrl+Backspace (kill line)", () => {
    test("sends kill-line sequence on keydown", () => {
      const onWrite = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onWrite })
      const e = key({ key: "Backspace", ctrlKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
      expect(onWrite).toHaveBeenCalledWith("\x15\x1b[D")
    })

    test("does not send on keyup", () => {
      const onWrite = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onWrite })
      key({ key: "Backspace", ctrlKey: true, type: "keyup" })
      const e = key({ key: "Backspace", ctrlKey: true, type: "keyup" })
      term.state.fn(e.event)

      expect(onWrite).not.toHaveBeenCalled()
    })
  })

  // Ctrl+Left / Ctrl+Right (non-Mac / default test env)
  describe("Ctrl+Left (beginning of line)", () => {
    test("sends Ctrl+A on keydown", () => {
      const onWrite = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onWrite })
      const e = key({ key: "ArrowLeft", ctrlKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
      expect(onWrite).toHaveBeenCalledWith("\x01")
    })
  })

  describe("Ctrl+Right (end of line)", () => {
    test("sends Ctrl+E on keydown", () => {
      const onWrite = vi.fn()
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, { onWrite })
      const e = key({ key: "ArrowRight", ctrlKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
      expect(onWrite).toHaveBeenCalledWith("\x05")
    })
  })

  // Mac-specific: metaKey as actionMod
  describe("Mac platform (metaKey as actionMod)", () => {
    const originalNavigator = globalThis.navigator

    function mockMacNavigator() {
      Object.defineProperty(globalThis, "navigator", {
        value: { platform: "MacIntel" },
        writable: true,
        configurable: true,
      })
    }

    function restoreNavigator() {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      })
    }

    test("Cmd+Backspace sends kill-line on Mac", () => {
      mockMacNavigator()
      try {
        const onWrite = vi.fn()
        const term = xterm()
        setupKeyboardHandler(term.terminal as never, { onWrite })
        const e = key({ key: "Backspace", metaKey: true })
        const result = term.state.fn(e.event)

        expect(result).toBe(false)
        expect(onWrite).toHaveBeenCalledWith("\x15\x1b[D")
      } finally {
        restoreNavigator()
      }
    })

    test("Cmd+Left sends Ctrl+A on Mac", () => {
      mockMacNavigator()
      try {
        const onWrite = vi.fn()
        const term = xterm()
        setupKeyboardHandler(term.terminal as never, { onWrite })
        const e = key({ key: "ArrowLeft", metaKey: true })
        const result = term.state.fn(e.event)

        expect(result).toBe(false)
        expect(onWrite).toHaveBeenCalledWith("\x01")
      } finally {
        restoreNavigator()
      }
    })

    test("Cmd+Right sends Ctrl+E on Mac", () => {
      mockMacNavigator()
      try {
        const onWrite = vi.fn()
        const term = xterm()
        setupKeyboardHandler(term.terminal as never, { onWrite })
        const e = key({ key: "ArrowRight", metaKey: true })
        const result = term.state.fn(e.event)

        expect(result).toBe(false)
        expect(onWrite).toHaveBeenCalledWith("\x05")
      } finally {
        restoreNavigator()
      }
    })
  })

  // Passthrough cases
  describe("passthrough", () => {
    test("Ctrl+backtick passes through", () => {
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, {})
      const e = key({ key: "`", ctrlKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(true)
    })

    test("unhandled regular key passes through", () => {
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, {})
      const e = key({ key: "a" })
      const result = term.state.fn(e.event)

      expect(result).toBe(true)
    })
  })

  // Cleanup
  test("cleanup restores default passthrough handler", () => {
    const term = xterm()
    const cleanup = setupKeyboardHandler(term.terminal as never, {})

    // Before cleanup, Shift+Enter should be intercepted
    const e1 = key({ key: "Enter", shiftKey: true })
    expect(term.state.fn(e1.event)).toBe(false)

    // After cleanup, all keys should pass through
    cleanup()
    const e2 = key({ key: "Enter", shiftKey: true })
    expect(term.state.fn(e2.event)).toBe(true)
  })

  // No callbacks = no crash
  describe("no callbacks provided", () => {
    test("Shift+Enter returns false without crashing", () => {
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, {})
      const e = key({ key: "Enter", shiftKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
    })

    test("Ctrl+Backspace returns false without crashing", () => {
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, {})
      const e = key({ key: "Backspace", ctrlKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
    })

    test("Cmd+D returns false without crashing", () => {
      const term = xterm()
      setupKeyboardHandler(term.terminal as never, {})
      const e = key({ key: "d", metaKey: true })
      const result = term.state.fn(e.event)

      expect(result).toBe(false)
    })
  })
})
