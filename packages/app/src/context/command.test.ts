import { describe, expect, test } from "bun:test"
import { isReservedTerminalShortcut, isTerminalEvent, matchKeybind, parseKeybind, upsertCommandRegistration } from "./command"

describe("upsertCommandRegistration", () => {
  test("replaces keyed registrations", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ key: "layout", options: one }], { key: "layout", options: two })

    expect(next).toHaveLength(1)
    expect(next[0]?.options).toBe(two)
  })

  test("keeps unkeyed registrations additive", () => {
    const one = () => [{ id: "one", title: "One" }]
    const two = () => [{ id: "two", title: "Two" }]

    const next = upsertCommandRegistration([{ options: one }], { options: two })

    expect(next).toHaveLength(2)
    expect(next[0]?.options).toBe(two)
    expect(next[1]?.options).toBe(one)
  })
})

describe("isTerminalEvent", () => {
  test("returns true for events from inside terminal component", () => {
    document.body.innerHTML = `<div data-component="terminal"><textarea></textarea></div>`
    const target = document.querySelector("textarea")!
    expect(isTerminalEvent({ target, composedPath: () => [target] })).toBe(true)
  })

  test("returns false for events outside terminal component", () => {
    document.body.innerHTML = `<div><button>Run</button></div>`
    const target = document.querySelector("button")!
    expect(isTerminalEvent({ target, composedPath: () => [target] })).toBe(false)
  })

  test("returns true when active element is in terminal even if event target is window", () => {
    document.body.innerHTML = `<div data-component="terminal"><textarea id="t"></textarea></div>`
    const target = document.querySelector("#t") as HTMLTextAreaElement
    target.focus()
    expect(document.activeElement).toBe(target)
    expect(isTerminalEvent({ target: window, composedPath: () => [window] })).toBe(true)
  })
})

describe("isReservedTerminalShortcut", () => {
  test("returns true for terminal-conflicting shortcuts", () => {
    expect(isReservedTerminalShortcut("d:2")).toBe(true)
    expect(isReservedTerminalShortcut("d:6")).toBe(true)
    expect(isReservedTerminalShortcut("w:2")).toBe(true)
  })

  test("returns false for non-conflicting shortcuts", () => {
    expect(isReservedTerminalShortcut("\\:2")).toBe(false)
    expect(isReservedTerminalShortcut("1:2")).toBe(false)
    expect(isReservedTerminalShortcut("p:6")).toBe(false)
  })
})

describe("mod+backslash keybind (split toggle)", () => {
  const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

  test("parseKeybind handles backslash key after mod", () => {
    const keybinds = parseKeybind("mod+\\")
    expect(keybinds).toHaveLength(1)
    expect(keybinds[0].key).toBe("\\")
    if (IS_MAC) {
      expect(keybinds[0].meta).toBe(true)
      expect(keybinds[0].ctrl).toBe(false)
    } else {
      expect(keybinds[0].ctrl).toBe(true)
      expect(keybinds[0].meta).toBe(false)
    }
  })

  test("matchKeybind matches Cmd+Backslash event when mod resolves to meta", () => {
    const keybinds = parseKeybind("mod+\\")
    // Simulate Cmd+\ on Mac (metaKey=true)
    const event = new KeyboardEvent("keydown", {
      key: "\\",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    })
    // On Mac IS_MAC=true → mod=meta → should match metaKey event
    // On non-Mac IS_MAC=false → mod=ctrl → should NOT match metaKey event
    expect(matchKeybind(keybinds, event)).toBe(IS_MAC)
  })

  test("mod+backslash is not a reserved terminal shortcut", () => {
    // \\:2 = backslash + meta (Cmd on Mac)
    expect(isReservedTerminalShortcut("\\:2")).toBe(false)
    // \\:1 = backslash + ctrl
    expect(isReservedTerminalShortcut("\\:1")).toBe(false)
  })

  test("Cmd+Backslash event dispatches through terminal focus without being blocked", () => {
    // Set up a terminal element with focus
    document.body.innerHTML = `<div data-component="terminal"><textarea id="term"></textarea></div>`
    const target = document.querySelector("#term") as HTMLTextAreaElement
    target.focus()

    const event = new KeyboardEvent("keydown", {
      key: "\\",
      metaKey: true,
      bubbles: true,
    })

    // Verify the event IS from a terminal context
    expect(isTerminalEvent({ target, composedPath: () => [target] })).toBe(true)

    // Verify the backslash+meta shortcut is NOT reserved (so it won't be blocked)
    expect(isReservedTerminalShortcut("\\:2")).toBe(false)

    // Verify the keybind matches the event
    const keybinds = parseKeybind("meta+\\") // use explicit meta to be platform-independent
    expect(matchKeybind(keybinds, event)).toBe(true)
  })
})
