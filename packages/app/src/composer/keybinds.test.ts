import { describe, expect, test } from "bun:test"
import { matchPromptKeybind, promptKeybindOptions } from "./keybinds"

function keyEvent(input: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key: "Enter", ...input })
}

describe("prompt keybind matching", () => {
  test("keeps prompt actions out of the global keymap", () => {
    expect(promptKeybindOptions({ submit: "Submit", newline: "Newline" }).map((option) => option.disabled)).toEqual([
      true,
      true,
    ])
  })

  test("preserves submit defaults without overriding alternate delivery", () => {
    expect(matchPromptKeybind("submit", {}, keyEvent())).toBe(true)
    expect(matchPromptKeybind("submit", {}, keyEvent({ ctrlKey: true }))).toBe(false)
    expect(matchPromptKeybind("submit", {}, keyEvent({ metaKey: true }))).toBe(false)
    expect(matchPromptKeybind("submit", {}, keyEvent({ altKey: true }))).toBe(true)
  })

  test("preserves shifted newline variants without an override", () => {
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, metaKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", {}, keyEvent({ shiftKey: true, altKey: true }))).toBe(true)
  })

  test("uses exact matching after an explicit override", () => {
    expect(matchPromptKeybind("submit", { submit: "enter" }, keyEvent({ ctrlKey: true }))).toBe(false)
    expect(matchPromptKeybind("submit", { submit: "ctrl+enter" }, keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", { newline: "shift+enter" }, keyEvent({ shiftKey: true, ctrlKey: true }))).toBe(
      false,
    )
  })

  test("lets explicit bindings override the other action fallback", () => {
    const event = keyEvent({ ctrlKey: true, shiftKey: true })
    const overrides = { submit: "ctrl+shift+enter" }

    expect(matchPromptKeybind("newline", overrides, event)).toBe(false)
    expect(matchPromptKeybind("submit", overrides, event)).toBe(true)
  })

  test("supports none and swapped bindings", () => {
    expect(matchPromptKeybind("submit", { submit: "none" }, keyEvent())).toBe(false)
    expect(matchPromptKeybind("newline", { newline: "none" }, keyEvent({ shiftKey: true }))).toBe(false)

    const overrides = { submit: "shift+enter", newline: "enter" }
    expect(matchPromptKeybind("submit", overrides, keyEvent({ shiftKey: true }))).toBe(true)
    expect(matchPromptKeybind("newline", overrides, keyEvent())).toBe(true)
  })
})
