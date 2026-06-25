import { describe, expect, test } from "bun:test"
import { promptEnterKeyAction } from "./keyboard"

describe("prompt-input keyboard", () => {
  test("uses Enter for newline on mobile web", () => {
    expect(promptEnterKeyAction({ key: "Enter", shiftKey: false, mobileWeb: true })).toBe("newline")
  })

  test("keeps desktop plain Enter as submit", () => {
    expect(promptEnterKeyAction({ key: "Enter", shiftKey: false, mobileWeb: false })).toBe("submit")
  })

  test("keeps Shift+Enter as newline", () => {
    expect(promptEnterKeyAction({ key: "Enter", shiftKey: true, mobileWeb: false })).toBe("newline")
  })

  test("ignores non-Enter keys", () => {
    expect(promptEnterKeyAction({ key: "a", shiftKey: false, mobileWeb: true })).toBe("none")
  })
})
