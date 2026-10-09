import { expect, test } from "bun:test"
import {
  decodePresenterEvents,
  keyName,
  toInputEvents,
  type Modifiers,
  type PresenterEvent,
  type ReplayedInput,
} from "./presenter-input"

const none: Modifiers = { shift: false, control: false, alt: false, meta: false }

const key = (input: Partial<Extract<PresenterEvent, { kind: "key" }>>): PresenterEvent => ({
  kind: "key",
  type: "down",
  key: "a",
  code: "KeyA",
  repeat: false,
  modifiers: none,
  ...input,
})

test("untrusted batches keep valid events and drop the rest", () => {
  expect(
    decodePresenterEvents(
      JSON.stringify([{ kind: "focus" }, { kind: "mouse", type: "teleport" }, { kind: "text", text: "日本" }, 7]),
    ),
  ).toEqual([{ kind: "focus" }, { kind: "text", text: "日本" }])
  expect(decodePresenterEvents("not json")).toEqual([])
  expect(decodePresenterEvents('{"kind":"focus"}')).toEqual([])
})

// Measured in Electron 44: a char event for a named key inserts its name ("Insert", "F24") into a focused input.
const keys: Array<{ key: string; code: string; modifiers: Modifiers; expected: ReplayedInput[] }> = [
  { key: "a", code: "KeyA", modifiers: none, expected: [{ type: "keyDown", keyCode: "a", modifiers: [] }, { type: "char", keyCode: "a", modifiers: [] }] },
  { key: "Enter", code: "Enter", modifiers: none, expected: [{ type: "keyDown", keyCode: "Enter", modifiers: [] }, { type: "char", keyCode: "\r", modifiers: [] }] },
  { key: "ArrowUp", code: "ArrowUp", modifiers: none, expected: [{ type: "keyDown", keyCode: "Up", modifiers: [] }] },
  { key: "Insert", code: "Insert", modifiers: none, expected: [{ type: "keyDown", keyCode: "Insert", modifiers: [] }] },
  { key: "F24", code: "F24", modifiers: none, expected: [{ type: "keyDown", keyCode: "F24", modifiers: [] }] },
  { key: " ", code: "Space", modifiers: none, expected: [{ type: "keyDown", keyCode: "Space", modifiers: [] }, { type: "char", keyCode: " ", modifiers: [] }] },
  { key: "v", code: "KeyV", modifiers: { ...none, control: true }, expected: [{ type: "keyDown", keyCode: "v", modifiers: ["control"] }] },
  {
    key: "@",
    code: "KeyQ",
    modifiers: { ...none, control: true, alt: true },
    expected: [{ type: "keyDown", keyCode: "@", modifiers: ["control", "alt"] }, { type: "char", keyCode: "@", modifiers: ["control", "alt"] }],
  },
  { key: "Dead", code: "KeyE", modifiers: none, expected: [{ type: "keyDown", keyCode: "e", modifiers: [] }] },
  { key: "Process", code: "Unidentified", modifiers: none, expected: [] },
]

test.each(keys)("key $key ($code) replays as typed input", (item) => {
  expect(toInputEvents(key({ key: item.key, code: item.code, modifiers: item.modifiers }))).toEqual(item.expected)
})

test("key up and auto-repeat keep their modifiers", () => {
  expect(toInputEvents(key({ type: "up", key: "Shift", code: "ShiftLeft" }))).toEqual([])
  expect(toInputEvents(key({ type: "up", key: "x", code: "KeyX", modifiers: { ...none, shift: true } }))).toEqual([
    { type: "keyUp", keyCode: "x", modifiers: ["shift"] },
  ])
  expect(toInputEvents(key({ key: "x", code: "KeyX", repeat: true }))[0]).toEqual({
    type: "keyDown",
    keyCode: "x",
    modifiers: ["isautorepeat"],
  })
})

// Measured in Electron 44: mouseWheel deltaY -120 scrolls the page down by 120.
test("wheel deltas invert to Chromium's direction and scale lines and pages", () => {
  const wheel = (deltaY: number, deltaMode: 0 | 1 | 2) =>
    toInputEvents({ kind: "wheel", x: 10.4, y: 20.6, deltaX: 0, deltaY, deltaMode, modifiers: none })[0]

  expect(wheel(120, 0)).toMatchObject({ type: "mouseWheel", x: 10, y: 21, deltaY: -120, canScroll: true })
  expect(wheel(3, 1)).toMatchObject({ deltaY: -120 })
  expect(wheel(1, 2)).toMatchObject({ deltaY: -800 })
})

test("mouse events carry the button, click count, and held buttons", () => {
  expect(
    toInputEvents({ kind: "mouse", type: "down", x: 1, y: 2, button: 2, buttons: 2, clicks: 1, modifiers: none }),
  ).toEqual([{ type: "mouseDown", x: 1, y: 2, button: "right", clickCount: 1, modifiers: ["rightbuttondown"] }])
  expect(
    toInputEvents({ kind: "mouse", type: "move", x: 5, y: 5, button: 0, buttons: 1, clicks: 0, modifiers: { ...none, shift: true } }),
  ).toEqual([{ type: "mouseMove", x: 5, y: 5, button: "left", clickCount: 1, modifiers: ["shift", "leftbuttondown"] }])
})

test("key names follow the physical key when the logical one is unknown", () => {
  expect(keyName("Dead", "Digit4")).toBe("4")
  expect(keyName("Unidentified", "Backquote")).toBeUndefined()
  expect(keyName("ArrowLeft", "ArrowLeft")).toBe("Left")
})
