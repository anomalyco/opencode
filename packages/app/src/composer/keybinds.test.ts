import { describe, expect, test } from "bun:test"
import { matchPromptKeybind, promptKeybindOptions } from "./keybinds"
import { matchKeybind, parseKeybind } from "@/shell/commands/command"

function keyEvent(input: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key: "Enter", ...input })
}

describe("prompt keybind matching", () => {
  test("declares every accepted default variant for Settings conflict detection", () => {
    const options = promptKeybindOptions({ submit: "Submit", newline: "Newline", alternate: "Alternate" })

    for (const input of [
      { id: "prompt.submit", event: keyEvent({ altKey: true }) },
      { id: "prompt.newline", event: keyEvent({ ctrlKey: true, shiftKey: true }) },
      { id: "prompt.newline", event: keyEvent({ altKey: true, metaKey: true, shiftKey: true }) },
      { id: "prompt.submit.alternate", event: keyEvent({ ctrlKey: true }) },
      { id: "prompt.submit.alternate", event: keyEvent({ metaKey: true }) },
    ]) {
      expect(matchKeybind(parseKeybind(options.find((option) => option.id === input.id)!.keybind), input.event)).toBe(
        true,
      )
    }
  })

  test("advertises only remaining defaults after an explicit binding takes a chord", () => {
    const options = promptKeybindOptions(
      { submit: "Submit", newline: "Newline", alternate: "Alternate" },
      { submit: "ctrl+shift+enter" },
    )

    const newline = options.find((option) => option.id === "prompt.newline")
    expect(newline).toBeDefined()
    expect(matchKeybind(parseKeybind(newline?.keybind ?? "none"), keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(
      false,
    )
    expect(matchKeybind(parseKeybind(newline?.keybind ?? "none"), keyEvent({ shiftKey: true }))).toBe(true)
    expect(options.find((option) => option.id === "prompt.submit")?.keybind).toBe("ctrl+shift+enter")
  })

  test("preserves all sixteen legacy Enter modifier combinations", () => {
    const expected = [
      "submit",
      "newline",
      "alternate",
      "newline",
      "alternate",
      "newline",
      "alternate",
      "newline",
      "submit",
      "newline",
      "alternate",
      "newline",
      "alternate",
      "newline",
      "alternate",
      "newline",
    ]

    expected.forEach((action, mask) => {
      const event = keyEvent({
        shiftKey: !!(mask & 1),
        ctrlKey: !!(mask & 2),
        metaKey: !!(mask & 4),
        altKey: !!(mask & 8),
      })

      expect(matchPromptKeybind("submit", {}, event)).toBe(action === "submit")
      expect(matchPromptKeybind("newline", {}, event)).toBe(action === "newline")
      expect(matchPromptKeybind("alternate", {}, event)).toBe(action === "alternate")
    })
  })

  test("rebinds, disables, and swaps alternate delivery with submit", () => {
    expect(matchPromptKeybind("alternate", {}, keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("alternate", {}, keyEvent({ metaKey: true }))).toBe(true)
    expect(matchPromptKeybind("alternate", { alternate: "none" }, keyEvent({ ctrlKey: true }))).toBe(false)
    const overrides = { alternate: "enter", submit: "ctrl+enter" }
    expect(matchPromptKeybind("alternate", overrides, keyEvent())).toBe(true)
    expect(matchPromptKeybind("alternate", overrides, keyEvent({ ctrlKey: true }))).toBe(false)
    expect(matchPromptKeybind("submit", overrides, keyEvent({ ctrlKey: true }))).toBe(true)
    expect(matchPromptKeybind("submit", { alternate: "enter" }, keyEvent())).toBe(false)
    expect(matchPromptKeybind("newline", { alternate: "shift+enter" }, keyEvent({ shiftKey: true }))).toBe(false)
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
