import { describe, expect, test } from "bun:test"
import { terminalKeyInput } from "./terminal-key-event"

describe("terminalKeyInput", () => {
  test("maps Command+Delete to the terminal line-clear control code", () => {
    const event = new KeyboardEvent("keydown", { key: "Backspace", metaKey: true })

    expect(terminalKeyInput(event)).toBe("\x15")
  })

  test("leaves other Backspace shortcuts to the terminal", () => {
    expect(terminalKeyInput(new KeyboardEvent("keydown", { key: "Backspace" }))).toBeUndefined()
    expect(
      terminalKeyInput(new KeyboardEvent("keydown", { key: "Backspace", metaKey: true, shiftKey: true })),
    ).toBeUndefined()
  })
})
