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

  test("initial command is blocked after marker is set", () => {
    markInitialCommandRan("pty-1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(false)
  })

  test("clearing marker re-enables initial command", () => {
    markInitialCommandRan("pty-1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(false)
    clearInitialCommandMarker("pty-1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(true)
  })

  test("mark and clear are scoped to individual pty ids", () => {
    markInitialCommandRan("pty-1")
    expect(shouldRunInitialCommand({ id: "pty-1", initialCommand: "codex" })).toBe(false)
    expect(shouldRunInitialCommand({ id: "pty-2", initialCommand: "codex" })).toBe(true)
  })
})
