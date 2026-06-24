import { describe, expect, test } from "bun:test"
import { customInputKeyAction } from "./session-question-dock"

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
  const event = new KeyboardEvent("keydown", init)
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: init.keyCode })
  }
  return event
}

describe("customInputKeyAction", () => {
  test("commits on plain Enter", () => {
    expect(customInputKeyAction(key({ key: "Enter" }))).toBe("commit")
  })

  test("ignores Enter while an IME is composing (isComposing)", () => {
    expect(customInputKeyAction(key({ key: "Enter", isComposing: true }))).toBe("ignore")
  })

  test("ignores Enter while an IME is composing (keyCode 229 fallback)", () => {
    expect(customInputKeyAction(key({ key: "Enter", keyCode: 229 }))).toBe("ignore")
  })

  test("ignores Shift+Enter (newline)", () => {
    expect(customInputKeyAction(key({ key: "Enter", shiftKey: true }))).toBe("ignore")
  })

  test("escapes on Escape", () => {
    expect(customInputKeyAction(key({ key: "Escape" }))).toBe("escape")
  })

  test("ignores Cmd/Ctrl+Enter so the dock-level handler can act", () => {
    expect(customInputKeyAction(key({ key: "Enter", metaKey: true }))).toBe("ignore")
    expect(customInputKeyAction(key({ key: "Enter", ctrlKey: true }))).toBe("ignore")
  })

  test("ignores non-Enter typing keys", () => {
    expect(customInputKeyAction(key({ key: "a" }))).toBe("ignore")
  })
})
