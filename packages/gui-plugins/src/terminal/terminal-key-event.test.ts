import { describe, expect, test } from "bun:test"
import { consumeTerminalMetaKey, terminalKeyInput } from "./terminal-key-event"

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", { cancelable: true, ...init })
}

describe("terminalKeyEvent", () => {
  test("maps unmodified Command+Backspace to line kill", () => {
    expect(terminalKeyInput(keyEvent({ key: "Backspace", code: "Backspace", metaKey: true }))).toBe("\x15")
    expect(terminalKeyInput(keyEvent({ key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true }))).toBeUndefined()
  })

  test("consumes printable Command chords but leaves physical paste and copy to ghostty-web", () => {
    expect(consumeTerminalMetaKey(keyEvent({ key: "k", code: "KeyK", metaKey: true }))).toBe(true)
    expect(consumeTerminalMetaKey(keyEvent({ key: "a", code: "KeyA", metaKey: true }))).toBe(true)
    expect(consumeTerminalMetaKey(keyEvent({ key: "v", code: "KeyV", metaKey: true }))).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyC", metaKey: true }))).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true }))).toBe(false)
  })

  test("keeps paste and copy working on RTL and non-QWERTY layouts", () => {
    expect(consumeTerminalMetaKey(keyEvent({ key: "ر", code: "KeyV", metaKey: true }))).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "ؤ", code: "KeyC", metaKey: true }))).toBe(false)

    let pasted = 0
    expect(consumeTerminalMetaKey(keyEvent({ key: "v", code: "Period", metaKey: true }), { paste: () => void (pasted += 1) })).toBe(true)
    expect(pasted).toBe(1)

    expect(consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyI", metaKey: true }), { copy: () => true })).toBe(true)
  })

  test("never consumes Ctrl chords so they reach the shell", () => {
    expect(consumeTerminalMetaKey(keyEvent({ key: "c", code: "KeyC", ctrlKey: true }))).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "a", code: "KeyA", ctrlKey: true }))).toBe(false)
    expect(consumeTerminalMetaKey(keyEvent({ key: "k", code: "KeyK", ctrlKey: true, metaKey: true }))).toBe(false)
  })
})
