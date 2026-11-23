import { describe, expect, test } from "bun:test"
import {
  initialKeyboardModeState,
  selectFocusRings,
  transitionKeyboardMode,
  type KeyboardModeEvent,
  type KeyboardModeState,
} from "./keyboard-mode-machine"

type Event = KeyboardModeEvent<string>

const key = (
  name: string,
  options: { on?: "control" | "other"; modified?: boolean; focused?: string | null } = {},
): Event => ({
  type: "key",
  key: name,
  modified: options.modified ?? false,
  target: options.on ?? "other",
  focused: options.focused === undefined ? "button" : options.focused,
})

const focus = (focused: string): Event => ({ type: "focus", focused })

const settled: Event = { type: "key.settled" }

const pointer: Event = { type: "pointer" }

const run = (...events: Event[]) =>
  events.reduce<KeyboardModeState<string>>(transitionKeyboardMode, initialKeyboardModeState)

describe("keyboard mode", () => {
  test.each([
    { name: "Tab that moves focus", events: [key("Tab"), focus("next")], expected: true },
    { name: "Tab from the page itself", events: [key("Tab", { focused: null }), focus("next")], expected: true },
    { name: "an arrow that moves focus between items", events: [key("ArrowDown"), focus("next")], expected: true },
    { name: "Home that moves focus", events: [key("Home"), focus("next")], expected: true },
    { name: "Enter on a focused control", events: [key("Enter", { on: "control" })], expected: true },
    { name: "Space on a focused control", events: [key(" ", { on: "control" })], expected: true },
    { name: "an arrow on a focused control", events: [key("ArrowRight", { on: "control" })], expected: true },

    { name: "Tab that a handler cancels", events: [key("Tab"), settled], expected: false },
    { name: "an arrow that only scrolls or moves the caret", events: [key("ArrowDown"), settled], expected: false },
    {
      name: "focus the app moves after the key press ended",
      events: [key("Tab"), settled, focus("next")],
      expected: false,
    },
    { name: "focus that lands back on the same element", events: [key("Tab"), focus("button")], expected: false },
    { name: "typing a letter", events: [key("a"), focus("next")], expected: false },
    { name: "typing a letter on a control", events: [key("a", { on: "control" }), focus("next")], expected: false },
    { name: "Enter in a text field or a scroll region", events: [key("Enter"), focus("next")], expected: false },
    { name: "Escape on a control", events: [key("Escape", { on: "control" }), focus("next")], expected: false },
    { name: "a lone Shift", events: [key("Shift", { on: "control" }), focus("next")], expected: false },
    { name: "a shortcut that moves focus", events: [key("Tab", { modified: true }), focus("next")], expected: false },
    { name: "a shortcut on a control", events: [key("Enter", { on: "control", modified: true })], expected: false },
    { name: "focus the app moves on its own", events: [focus("next")], expected: false },

    { name: "a pointer press after keyboard use", events: [key("Tab"), focus("next"), pointer], expected: false },
    {
      name: "a pointer press while a key is moving focus",
      events: [key("Tab"), pointer, focus("next")],
      expected: false,
    },
    {
      name: "typing, shortcuts and app focus after keyboard use",
      events: [
        key("Tab"),
        focus("next"),
        key("a"),
        key("c", { modified: true }),
        key("Escape"),
        settled,
        focus("button"),
      ],
      expected: true,
    },
  ])("$name", ({ events, expected }) => {
    expect(selectFocusRings(run(...events))).toBe(expected)
  })

  test("returns the same state for an event that does not apply", () => {
    const keyboard = run(key("Tab"), focus("next"))

    expect(run(pointer)).toBe(initialKeyboardModeState)
    expect(run(settled)).toBe(initialKeyboardModeState)
    expect(run(key("a"))).toBe(initialKeyboardModeState)
    expect(transitionKeyboardMode(keyboard, key("Tab"))).toBe(keyboard)
    expect(transitionKeyboardMode(keyboard, focus("button"))).toBe(keyboard)
  })
})
