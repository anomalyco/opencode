import { describe, expect, test } from "bun:test"
import { consumeTerminalMetaKey, terminalKeyInput } from "./terminal-key-event"

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", { cancelable: true, ...init })
}

describe("terminalKeyEvent", () => {
  test("maps unmodified Command+Backspace to line kill", () => {
    expect(terminalKeyInput(keyEvent({ key: "Backspace", code: "Backspace", metaKey: true }))).toBe("\x15")
    expect(terminalKeyInput(keyEvent({ key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true }))).toBeUndefined()
    expect(terminalKeyInput(keyEvent({ key: "Backspace", code: "Backspace", ctrlKey: true }))).toBeUndefined()
  })

  test("consumes printable Command chords without blocking paste or copy across layouts", () => {
    let pasted = 0
    expect(consumeTerminalMetaKey(keyEvent({ key: "v", code: "KeyV", metaKey: true }), { paste: () => void (pasted += 1) })).toBe(
      false,
    )
    expect(pasted).toBe(0)

    expect(consumeTerminalMetaKey(keyEvent({ key: "v", code: "Period", metaKey: true }), { paste: () => void (pasted += 1) })).toBe(
      true,
    )
    expect(pasted).toBe(1)

    expect(consumeTerminalMetaKey(keyEvent({ key: ".", code: "KeyV", metaKey: true }))).toBe(true)
    expect(consumeTerminalMetaKey(keyEvent({ key: "k", code: "KeyK", metaKey: true }))).toBe(true)

    let copied = 0
    expect(
      consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyI", metaKey: true }), {
        copy: () => {
          copied += 1

          return true
        },
      }),
    ).toBe(true)
    expect(copied).toBe(1)

    expect(consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyC", metaKey: true }), { copy: () => false })).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyI", metaKey: true }), { copy: () => false })).toBe(true)
    expect(consumeTerminalMetaKey(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true }))).toBe(false)
  })
})
