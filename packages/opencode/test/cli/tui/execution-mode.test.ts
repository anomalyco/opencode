import { describe, test, expect, beforeEach } from "bun:test"
import { ModeController, ExecutionMode, getModeDisplay, getModeController } from "@shell-mode"
import { handleModeToggleKey, shouldUseShellCompletion } from "@tui-integration"

import type { KeyEvent } from "@opentui/core"

// Minimal KeyEvent shape for testing — only the fields handleModeToggleKey reads
function makeKey(overrides: { ctrl?: boolean; meta?: boolean; shift?: boolean; name?: string; sequence?: string } = {}): KeyEvent {
  return {
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    name: "",
    sequence: "",
    number: false,
    raw: "",
    source: "raw" as const,
    eventType: "keydown" as never,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  } as unknown as KeyEvent
}

// ──────────────────────────────────────────────────────────
// ModeController state machine
// ──────────────────────────────────────────────────────────

describe("ModeController", () => {
  test("default mode is Auto", () => {
    const ctrl = new ModeController()
    expect(ctrl.getMode()).toBe(ExecutionMode.Auto)
  })

  test("setMode changes mode", () => {
    const ctrl = new ModeController()
    ctrl.setMode(ExecutionMode.Shell)
    expect(ctrl.getMode()).toBe(ExecutionMode.Shell)
    ctrl.setMode(ExecutionMode.Agent)
    expect(ctrl.getMode()).toBe(ExecutionMode.Agent)
    ctrl.setMode(ExecutionMode.Auto)
    expect(ctrl.getMode()).toBe(ExecutionMode.Auto)
  })

  test("toggleMode cycles Auto → Shell → Agent → Auto", () => {
    const ctrl = new ModeController()
    expect(ctrl.getMode()).toBe(ExecutionMode.Auto)

    expect(ctrl.toggleMode()).toBe(ExecutionMode.Shell)
    expect(ctrl.getMode()).toBe(ExecutionMode.Shell)

    expect(ctrl.toggleMode()).toBe(ExecutionMode.Agent)
    expect(ctrl.getMode()).toBe(ExecutionMode.Agent)

    expect(ctrl.toggleMode()).toBe(ExecutionMode.Auto)
    expect(ctrl.getMode()).toBe(ExecutionMode.Auto)
  })

  test("toggleMode wraps after three presses", () => {
    const ctrl = new ModeController()
    ctrl.toggleMode() // Auto → Shell
    ctrl.toggleMode() // Shell → Agent
    ctrl.toggleMode() // Agent → Auto
    ctrl.toggleMode() // Auto → Shell (second cycle)
    expect(ctrl.getMode()).toBe(ExecutionMode.Shell)
  })

  test("getModeDisplay returns Shell display", () => {
    const ctrl = new ModeController()
    ctrl.setMode(ExecutionMode.Shell)
    const display = ctrl.getModeDisplay()
    expect(display.name).toBe("Shell")
    expect(display.icon).toBe(">")
    expect(display.color).toBe("success")
  })

  test("getModeDisplay returns Agent display", () => {
    const ctrl = new ModeController()
    ctrl.setMode(ExecutionMode.Agent)
    const display = ctrl.getModeDisplay()
    expect(display.name).toBe("Agent")
    expect(display.icon).toBe("◆")
    expect(display.color).toBe("accent")
  })

  test("getModeDisplay returns Auto display", () => {
    const ctrl = new ModeController()
    ctrl.setMode(ExecutionMode.Auto)
    const display = ctrl.getModeDisplay()
    expect(display.name.trim()).toBe("Auto")
    expect(display.icon).toBe("∞")
    expect(display.color).toBe("diffAdded")
  })
})

// ──────────────────────────────────────────────────────────
// getModeDisplay (standalone function) — drives footer label and border color
// ──────────────────────────────────────────────────────────

describe("getModeDisplay", () => {
  test("Shell mode has success color", () => {
    const d = getModeDisplay(ExecutionMode.Shell)
    expect(d.color).toBe("success")
    expect(d.name).toBe("Shell")
  })

  test("Agent mode has accent color", () => {
    const d = getModeDisplay(ExecutionMode.Agent)
    expect(d.color).toBe("accent")
    expect(d.name).toBe("Agent")
  })

  test("Auto mode has diffAdded color", () => {
    const d = getModeDisplay(ExecutionMode.Auto)
    expect(d.color).toBe("diffAdded")
    expect(d.name.trim()).toBe("Auto")
  })

  test("each mode has a non-empty icon", () => {
    for (const mode of Object.values(ExecutionMode)) {
      expect(getModeDisplay(mode).icon.length).toBeGreaterThan(0)
    }
  })

  test("all three modes produce distinct colors", () => {
    const colors = Object.values(ExecutionMode).map((m) => getModeDisplay(m).color)
    expect(new Set(colors).size).toBe(3)
  })
})

// ──────────────────────────────────────────────────────────
// handleModeToggleKey — Ctrl+Space detection
// ──────────────────────────────────────────────────────────

describe("handleModeToggleKey", () => {
  beforeEach(() => {
    // Reset singleton to known state between tests
    getModeController().setMode(ExecutionMode.Auto)
  })

  test("ctrl+space (name=space) triggers toggle and returns true", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, name: "space" }), ctx)
    expect(result).toBe(true)
    expect(modes).toHaveLength(1)
    expect(modes[0]).toBe(ExecutionMode.Shell)
  })

  test("ctrl+space (name=\" \") triggers toggle and returns true", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, name: " " }), ctx)
    expect(result).toBe(true)
    expect(modes).toHaveLength(1)
  })

  test("ctrl+NUL sequence triggers toggle and returns true", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, sequence: "\x00" }), ctx)
    expect(result).toBe(true)
    expect(modes).toHaveLength(1)
  })

  test("non-ctrl space does not trigger toggle", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: false, name: "space" }), ctx)
    expect(result).toBe(false)
    expect(modes).toHaveLength(0)
  })

  test("ctrl+shift+space does not trigger toggle", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, shift: true, name: "space" }), ctx)
    expect(result).toBe(false)
    expect(modes).toHaveLength(0)
  })

  test("ctrl+meta+space does not trigger toggle", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, meta: true, name: "space" }), ctx)
    expect(result).toBe(false)
    expect(modes).toHaveLength(0)
  })

  test("unrelated key returns false and does not call setMode", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const result = handleModeToggleKey(makeKey({ ctrl: true, name: "a" }), ctx)
    expect(result).toBe(false)
    expect(modes).toHaveLength(0)
  })

  test("keybind matcher match=true triggers toggle", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const keybind = { match: (key: string) => key === "mode_toggle" ? true : undefined }
    const result = handleModeToggleKey(makeKey(), ctx, keybind)
    expect(result).toBe(true)
    expect(modes).toHaveLength(1)
  })

  test("keybind matcher match=false falls through to ctrl+space", () => {
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    // keybind doesn't match mode_toggle, but ctrl+space should NOT be used as fallback when keybind is provided
    const keybind = { match: (_key: string) => false as unknown as undefined }
    const result = handleModeToggleKey(makeKey({ ctrl: true, name: "space" }), keybind ? ctx : ctx, keybind)
    // When keybind is provided and doesn't match, function returns false
    expect(result).toBe(false)
    expect(modes).toHaveLength(0)
  })

  test("three consecutive toggles cycle through all modes", () => {
    getModeController().setMode(ExecutionMode.Auto)
    const modes: ExecutionMode[] = []
    const ctx = { setMode: (m: ExecutionMode) => modes.push(m) }
    const key = makeKey({ ctrl: true, name: "space" })

    handleModeToggleKey(key, ctx) // Auto → Shell
    handleModeToggleKey(key, ctx) // Shell → Agent
    handleModeToggleKey(key, ctx) // Agent → Auto

    expect(modes).toEqual([ExecutionMode.Shell, ExecutionMode.Agent, ExecutionMode.Auto])
  })
})

// ──────────────────────────────────────────────────────────
// shouldUseShellCompletion — tab completion routing
// ──────────────────────────────────────────────────────────

describe("shouldUseShellCompletion", () => {
  test("! prefix shell mode always uses shell completion", () => {
    for (const mode of Object.values(ExecutionMode)) {
      expect(shouldUseShellCompletion("shell", mode)).toBe(true)
    }
  })

  test("Shell execution mode uses shell completion in normal prompt mode", () => {
    expect(shouldUseShellCompletion("normal", ExecutionMode.Shell)).toBe(true)
  })

  test("Auto execution mode uses shell completion in normal prompt mode", () => {
    expect(shouldUseShellCompletion("normal", ExecutionMode.Auto)).toBe(true)
  })

  test("Agent execution mode does not use shell completion", () => {
    expect(shouldUseShellCompletion("normal", ExecutionMode.Agent)).toBe(false)
  })
})
