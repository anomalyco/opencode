import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { Clipboard } from "../clipboard"

describe("Clipboard TUI corruption", () => {
  let consoleSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleSpy = spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it("should NOT log to console on clipboard copy (corrupts TUI)", async () => {
    // This test FAILS with current code - proving the bug exists
    // The lazy() wrapper means getCopyMethod() fires on first copy
    await Clipboard.copy("test")

    // If this fails, console.log was called and would corrupt TUI
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})
