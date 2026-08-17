import { describe, expect, test } from "bun:test"
import { resolvePromptInputV2KeyAction } from "./keybind"

const keybinds = {
  submit: (event: KeyboardEvent) => event.key === "s" && event.metaKey,
  newline: (event: KeyboardEvent) => event.key === "Enter" && event.shiftKey,
}

function keyEvent(input: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">) {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    keyCode: 0,
    isComposing: false,
    ...input,
  } as KeyboardEvent
}

describe("prompt input V2 keybind resolution", () => {
  test("leaves bare Enter composition to the IME", () => {
    expect(
      resolvePromptInputV2KeyAction(
        keyEvent({ key: "Enter", isComposing: true }),
        {
          submit: () => false,
          newline: (event) => event.key === "Enter",
        },
        true,
      ),
    ).toBeUndefined()
  })

  test("keeps modified Enter newline bindings available during composition", () => {
    expect(resolvePromptInputV2KeyAction(keyEvent({ key: "Enter", shiftKey: true }), keybinds, true)).toBe("newline")
  })

  test("ignores non-Enter bindings during composition", () => {
    expect(resolvePromptInputV2KeyAction(keyEvent({ key: "n", metaKey: true }), keybinds, true)).toBeUndefined()
    expect(resolvePromptInputV2KeyAction(keyEvent({ key: "s", metaKey: true }), keybinds, true)).toBeUndefined()
  })

  test("recognizes arbitrary submit bindings", () => {
    expect(resolvePromptInputV2KeyAction(keyEvent({ key: "s", metaKey: true }), keybinds, false)).toBe("submit")
  })

  test("leaves unbound chords without an action", () => {
    expect(resolvePromptInputV2KeyAction(keyEvent({ key: "Enter", altKey: true }), keybinds, false)).toBeUndefined()
  })
})
