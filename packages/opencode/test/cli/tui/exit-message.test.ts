import { afterEach, describe, expect, test } from "bun:test"
import { ExitMessage } from "../../../src/cli/cmd/tui/exit-message"

afterEach(() => {
  ExitMessage.clear()
})

describe("exit-message", () => {
  test("registers and returns the current message", () => {
    ExitMessage.set("See you soon")
    expect(ExitMessage.get()).toBe("See you soon")
  })

  test("restores previous message on cleanup", () => {
    ExitMessage.set("First")
    const undo = ExitMessage.set("Second")
    expect(ExitMessage.get()).toBe("Second")
    undo()
    expect(ExitMessage.get()).toBe("First")
  })

  test("overwrites message with whitespace", () => {
    ExitMessage.set("Goodbye")
    ExitMessage.set("  ")
    expect(ExitMessage.get()).toBe("  ")
  })
})
