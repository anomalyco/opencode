import { beforeEach, describe, expect, test } from "bun:test"
import {
  clearInitialCommandMarker,
  initialCommandKey,
  markInitialCommandRan,
  shouldRunInitialCommand,
} from "./terminal-recovery"

describe("terminal recovery", () => {
  beforeEach(() => {
    localStorage.clear()
    clearInitialCommandMarker("pty-1")
  })

  test("initial command runs once when marker is absent", () => {
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(true)
  })

  test("initial command is blocked after marker is set in memory/localStorage", () => {
    markInitialCommandRan("pty-1")
    expect(localStorage.getItem(initialCommandKey("pty-1"))).toBe("1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(false)
  })

  test("initial command marker can be cleared when pty exits", () => {
    markInitialCommandRan("pty-1")
    clearInitialCommandMarker("pty-1")
    expect(localStorage.getItem(initialCommandKey("pty-1"))).toBeNull()
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(true)
  })

  test("initial_command_runs_once_across_remount", () => {
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(true)
    markInitialCommandRan("pty-1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(false)
    expect(localStorage.getItem(initialCommandKey("pty-1"))).toBe("1")
  })
})
