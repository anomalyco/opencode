import { expect, test } from "bun:test"
import { parseChord, typedKey } from "./keys"

// Names agents wrote in real sessions: Comma and Backquote were rejected before, Ctrl and Cmd were unknown.
test.each([
  ["Enter", { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0, text: "\r" }],
  ["Escape", { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, modifiers: 0 }],
  ["Esc", { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, modifiers: 0 }],
  ["ArrowDown", { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, modifiers: 0 }],
  ["Space", { key: " ", code: "Space", windowsVirtualKeyCode: 32, modifiers: 0, text: " " }],
  ["a", { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0, text: "a" }],
  ["Shift+a", { key: "A", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 8, text: "A" }],
  ["Control+A", { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }],
  ["Ctrl+a", { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }],
  ["Cmd+K", { key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 4 }],
  ["Meta+Shift+P", { key: "P", code: "KeyP", windowsVirtualKeyCode: 80, modifiers: 12 }],
  ["Comma", { key: ",", code: "Comma", windowsVirtualKeyCode: 188, modifiers: 0, text: "," }],
  ["Control+Comma", { key: ",", code: "Comma", windowsVirtualKeyCode: 188, modifiers: 2 }],
  ["Backquote", { key: "`", code: "Backquote", windowsVirtualKeyCode: 192, modifiers: 0, text: "`" }],
  ["Control+,", { key: ",", code: "Comma", windowsVirtualKeyCode: 188, modifiers: 2 }],
  ["Control++", { key: "+", code: "", windowsVirtualKeyCode: 0, modifiers: 2 }],
  ["Digit5", { key: "5", code: "Digit5", windowsVirtualKeyCode: 53, modifiers: 0, text: "5" }],
  ["F5", { key: "F5", code: "F5", windowsVirtualKeyCode: 116, modifiers: 0 }],
  ["F24", { key: "F24", code: "F24", windowsVirtualKeyCode: 135, modifiers: 0 }],
] as const)("press %s", (chord, expected) => {
  expect(parseChord(chord)).toEqual(expected)
})

test("unknown keys and modifiers teach the accepted names", () => {
  expect(() => parseChord("Hyper+A")).toThrow("Use Alt, Control, Meta, or Shift")
  expect(() => parseChord("Banana")).toThrow("KeyboardEvent.code such as Comma")
  expect(() => parseChord(" ")).toThrow("A key is required")
})

test("typing maps characters to key presses, and leaves characters without a key to text insertion", () => {
  expect(typedKey("h")).toEqual({ key: "h", code: "KeyH", windowsVirtualKeyCode: 72, modifiers: 0, text: "h" })
  expect(typedKey("H")).toEqual({ key: "H", code: "KeyH", windowsVirtualKeyCode: 72, modifiers: 8, text: "H" })
  expect(typedKey("\n")?.key).toBe("Enter")
  expect(typedKey(".")?.windowsVirtualKeyCode).toBe(190)
  expect(typedKey("😀")).toBeUndefined()
})
