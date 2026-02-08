import { describe, expect, test } from "bun:test"
import { ExitGuard, WINDOW_MS } from "../../../src/cli/cmd/tui/util/exit-guard"
import type { Keybind } from "../../../src/util/keybind"

function key(partial: Partial<Keybind.Info>): Keybind.Info {
  return {
    name: "",
    ctrl: false,
    meta: false,
    shift: false,
    super: false,
    leader: false,
    ...partial,
  }
}

describe("exit guard", () => {
  test("identifies exact Ctrl+C", () => {
    expect(ExitGuard.isCtrlC(key({ name: "c", ctrl: true }))).toBe(true)
    expect(ExitGuard.isCtrlC(key({ name: "d", ctrl: true }))).toBe(false)
    expect(ExitGuard.isCtrlC(key({ name: "c", ctrl: true, shift: true }))).toBe(false)
    expect(ExitGuard.isCtrlC(key({ name: "c", ctrl: true, leader: true }))).toBe(false)
  })

  test("first Ctrl+C confirms", () => {
    const result = ExitGuard.consume({ key: key({ name: "c", ctrl: true }), now: 1000 })
    expect(result).toEqual({ action: "confirm", pendingAt: 1000 })
  })

  test("second Ctrl+C within window exits", () => {
    const result = ExitGuard.consume({
      key: key({ name: "c", ctrl: true }),
      pendingAt: 1000,
      now: 1000 + WINDOW_MS,
    })
    expect(result).toEqual({ action: "exit" })
  })

  test("second Ctrl+C after timeout confirms again", () => {
    const result = ExitGuard.consume({
      key: key({ name: "c", ctrl: true }),
      pendingAt: 1000,
      now: 1000 + WINDOW_MS + 1,
    })
    expect(result).toEqual({ action: "confirm", pendingAt: 1000 + WINDOW_MS + 1 })
  })

  test("non-Ctrl+C exits immediately", () => {
    const result = ExitGuard.consume({ key: key({ name: "d", ctrl: true }), now: 1000 })
    expect(result).toEqual({ action: "exit" })
  })

  test("non-Ctrl+C clears pending confirmation", () => {
    const result = ExitGuard.consume({
      key: key({ name: "q", leader: true }),
      pendingAt: 1000,
      now: 1100,
    })
    expect(result).toEqual({ action: "exit" })
  })
})
