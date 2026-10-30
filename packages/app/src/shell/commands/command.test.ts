import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  activeCommandRegistrations,
  addCommandRegistration,
  commandPaletteOptions,
  CommandCatalog,
  commandKeymap,
  formatKeybind,
  keyFromKeyboardEvent,
  matchKeybind,
  parseKeybind,
  resolveKeybindOption,
  type CommandOption,
} from "./command"

test("command catalog persistence validates metadata and omits executable fields", () => {
  const decode = Schema.decodeUnknownSync(CommandCatalog)

  const catalog = decode({
    open: { title: "Open", keybind: "mod+o", hidden: false, onSelect: "invalid" },
    shell: { title: "Terminal", section: "terminal" },
    stale: { title: "Stale", section: "removed" },
    "acme.open": { plugin: "acme", title: "Open Acme" },
  })

  expect(catalog).toEqual({
    open: { title: "Open", keybind: "mod+o", hidden: false },
    shell: { title: "Terminal", section: "terminal" },
    stale: { title: "Stale" },
    "acme.open": { plugin: "acme", title: "Open Acme" },
  })
  expect(decode({})).toEqual({})
  expect(() => decode({ open: { title: 1 } })).toThrow()
  expect(decode(Schema.encodeSync(CommandCatalog)(catalog))).toEqual(catalog)
})

test("commandPaletteOptions keeps visible enabled commands", () => {
  const options: CommandOption[] = [
    { id: "settings.open", title: "Open settings" },
    { id: "session.undo", title: "Undo" },
    { id: "suggested.session.undo", title: "Undo" },
    { id: "file.open", title: "Open file" },
    { id: "hidden", title: "Hidden", hidden: true },
    { id: "disabled", title: "Disabled", disabled: true },
  ]

  expect(commandPaletteOptions(options).map((option) => option.id)).toEqual(["settings.open", "session.undo"])
})

test("command registrations shadow keyed owners, restore the previous owner, and keep unkeyed ones additive", () => {
  const one = () => [{ id: "one", title: "One" }]
  const two = () => [{ id: "two", title: "Two" }]

  const registrations = addCommandRegistration([{ key: "layout", options: one }], { key: "layout", options: two })
  expect(registrations).toHaveLength(2)
  expect(activeCommandRegistrations(registrations).map((entry) => entry.options)).toEqual([two])
  expect(
    activeCommandRegistrations(registrations.filter((entry) => entry.options !== two)).map((entry) => entry.options),
  ).toEqual([one])

  const unkeyed = activeCommandRegistrations(addCommandRegistration([{ options: one }], { options: two }))
  expect(unkeyed.map((entry) => entry.options)).toEqual([two, one])
})

test.each([true, false])("resolveKeybindOption prefers a contextual command only in its context: %p", (inside) => {
  const fallback = { id: "tab.close", title: "Close tab" }
  const contextual = { id: "terminal.close", title: "Close terminal", when: () => inside }

  expect(resolveKeybindOption([fallback, contextual], new KeyboardEvent("keydown"))).toBe(
    inside ? contextual : fallback,
  )
})

test("commandKeymap puts a user's binding before a default on the same keys", () => {
  const rename = { id: "session.rename", title: "Rename session", keybind: "ctrl+r" }
  const focus = { id: "input.focus", title: "Focus input", keybind: "ctrl+r" }
  const event = new KeyboardEvent("keydown", { key: "r", ctrlKey: true })
  const keymap = (custom: string[]) => commandKeymap([rename, focus], (id) => custom.includes(id)).get("r:1")

  expect(resolveKeybindOption(keymap([]), event)).toBe(rename)
  expect(resolveKeybindOption(keymap(["input.focus"]), event)).toBe(focus)
  expect(commandKeymap([{ ...rename, disabled: true }], () => false).size).toBe(0)
})

test.each([true, false])("resolveKeybindOption leaves the key to a skipping command's target: %p", (inside) => {
  const rename = { id: "session.rename", title: "Rename session", skip: () => inside }
  const focus = { id: "input.focus", title: "Focus input" }
  const event = new KeyboardEvent("keydown")

  expect(resolveKeybindOption([rename], event)).toBe(inside ? undefined : rename)
  expect(resolveKeybindOption([rename, focus], event)).toBe(inside ? focus : rename)
})

describe("command keybinds", () => {
  test("parseKeybind handles aliases, multiple combos, and disabled bindings", () => {
    const keybinds = parseKeybind("control+option+k, mod+shift+comma")

    expect(keybinds).toHaveLength(2)
    expect(keybinds[0]).toEqual({ key: "k", ctrl: true, meta: false, shift: false, alt: true })
    expect(keybinds[1]?.shift).toBe(true)
    expect(keybinds[1]?.key).toBe("comma")
    expect(Boolean(keybinds[1]?.ctrl || keybinds[1]?.meta)).toBe(true)
    expect(parseKeybind("none")).toEqual([])
    expect(parseKeybind("")).toEqual([])
  })

  // happy-dom never reports a Mac platform, so mod is Ctrl here.
  test.each([
    { config: "ctrl+comma", event: { key: ",", ctrlKey: true }, match: true },
    { config: "shift+plus", event: { key: "+", shiftKey: true }, match: true },
    { config: "meta+space", event: { key: " ", metaKey: true }, match: true },
    { config: "ctrl+comma", event: { key: ",", ctrlKey: true, altKey: true }, match: false },
    { config: "mod+alt+[", event: { key: "[", ctrlKey: true, altKey: true }, match: true },
    { config: "mod+alt+]", event: { key: "]", ctrlKey: true, altKey: true }, match: true },
    { config: "mod+alt+[", event: { key: "[", metaKey: true, altKey: true }, match: false },
    // ⇧[ types { on US layouts; Dvorak's slash on the physical bracket stays a slash; Russian's х falls back to it.
    { config: "mod+shift+[", event: { key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true }, match: true },
    { config: "mod+shift+]", event: { key: "}", code: "Equal", ctrlKey: true, shiftKey: true }, match: true },
    { config: "mod+shift+[", event: { key: "?", code: "BracketLeft", ctrlKey: true, shiftKey: true }, match: false },
    { config: "mod+shift+[", event: { key: "Х", code: "BracketLeft", ctrlKey: true, shiftKey: true }, match: true },
    // macOS Option turns L into ¬; the physical key still matches.
    { config: "meta+alt+l", event: { key: "¬", code: "KeyL", metaKey: true, altKey: true }, match: true },
    { config: "ctrl+f", event: { key: "а", code: "KeyF", ctrlKey: true }, match: true },
    { config: "meta+f", event: { key: "а", code: "KeyF", metaKey: true }, match: true },
    { config: "ctrl+shift+f", event: { key: "А", code: "KeyF", ctrlKey: true, shiftKey: true }, match: true },
    { config: "ctrl+g", event: { key: "γ", code: "KeyG", ctrlKey: true }, match: true },
    { config: "ctrl+e", event: { key: "ק", code: "KeyE", ctrlKey: true }, match: true },
    { config: "ctrl+comma", event: { key: "б", code: "Comma", ctrlKey: true }, match: true },
    { config: "ctrl+.", event: { key: "ю", code: "Period", ctrlKey: true }, match: true },
    { config: "ctrl+;", event: { key: "ж", code: "Semicolon", ctrlKey: true }, match: true },
    { config: "ctrl+'", event: { key: "э", code: "Quote", ctrlKey: true }, match: true },
    { config: "ctrl+[", event: { key: "х", code: "BracketLeft", ctrlKey: true }, match: true },
    { config: "ctrl+]", event: { key: "ъ", code: "BracketRight", ctrlKey: true }, match: true },
    { config: "ctrl+\\", event: { key: "む", code: "Backslash", ctrlKey: true }, match: true },
    { config: "ctrl+/", event: { key: "め", code: "Slash", ctrlKey: true }, match: true },
    { config: "ctrl+`", event: { key: "ё", code: "Backquote", ctrlKey: true }, match: true },
    { config: "ctrl+а", event: { key: "а", code: "KeyF", ctrlKey: true }, match: true },
    { config: "ctrl+х", event: { key: "х", code: "BracketLeft", ctrlKey: true }, match: true },
    { config: "а", event: { key: "а", code: "KeyF" }, match: true },
    { config: "f", event: { key: "а", code: "KeyF" }, match: false },
    { config: "shift+f", event: { key: "А", code: "KeyF", shiftKey: true }, match: false },
    { config: "ctrl+a", event: { key: "a", code: "KeyQ", ctrlKey: true }, match: true },
    { config: "ctrl+q", event: { key: "a", code: "KeyQ", ctrlKey: true }, match: false },
    { config: "ctrl+e", event: { key: "é", code: "KeyE", ctrlKey: true }, match: false },
    { config: "ctrl+f", event: { key: "а", code: "KeyF", metaKey: true }, match: false },
    { config: "ctrl+f", event: { key: "а", code: "KeyF", ctrlKey: true, shiftKey: true }, match: false },
    { config: "ctrl+f", event: { key: "а", code: "KeyF", ctrlKey: true, isComposing: true }, match: false },
    { config: "ctrl+[", event: { key: "х", code: "BracketLeft", ctrlKey: true, isComposing: true }, match: true },
    { config: "ctrl+f", event: { key: "Dead", code: "KeyF", ctrlKey: true }, match: false },
    { config: "ctrl+f", event: { key: "Unidentified", code: "KeyF", ctrlKey: true }, match: false },
    // Preserve the bracket fallback that already supports macOS Option and explicit Ctrl+Alt bindings.
    { config: "meta+alt+[", event: { key: "“", code: "BracketLeft", metaKey: true, altKey: true }, match: true },
    { config: "meta+alt+]", event: { key: "‘", code: "BracketRight", metaKey: true, altKey: true }, match: true },
    { config: "ctrl+alt+[", event: { key: "х", code: "BracketLeft", ctrlKey: true, altKey: true }, match: true },
    {
      config: "ctrl+[",
      event: { key: "х", code: "BracketLeft", ctrlKey: true, modifierAltGraph: true },
      match: true,
    },
    // Guard only the new fallback; existing Alt/bracket normalization still applies.
    {
      config: "alt+f",
      event: { key: "а", code: "KeyF", altKey: true, modifierAltGraph: true },
      match: true,
    },
    {
      config: "ctrl+alt+f",
      event: { key: "а", code: "KeyF", ctrlKey: true, altKey: true, modifierAltGraph: true },
      match: true,
    },
    {
      config: "meta+alt+[",
      event: { key: "“", code: "BracketLeft", metaKey: true, altKey: true, modifierAltGraph: true },
      match: true,
    },
    {
      config: "ctrl+alt+[",
      event: { key: "х", code: "BracketLeft", ctrlKey: true, altKey: true, modifierAltGraph: true },
      match: true,
    },
    {
      config: "meta+alt+l",
      event: { key: "¬", code: "KeyL", metaKey: true, altKey: true, isComposing: true },
      match: true,
    },
    {
      config: "ctrl+f",
      event: { key: "а", code: "KeyF", ctrlKey: true, modifierAltGraph: true },
      match: false,
    },
  ])("matchKeybind $config with $event.key is $match", (row) => {
    const event = new KeyboardEvent("keydown", row.event)

    // happy-dom treats every Alt key as AltGraph and ignores modifierAltGraph.
    const getModifierState = event.getModifierState.bind(event)
    event.getModifierState = (key) =>
      key === "AltGraph"
        ? "modifierAltGraph" in row.event && row.event.modifierAltGraph === true
        : getModifierState(key)
    expect(matchKeybind(parseKeybind(row.config), event)).toBe(row.match)
  })

  test.each([
    { event: { key: "х", code: "BracketLeft", ctrlKey: true }, key: "[" },
    { event: { key: "“", code: "BracketLeft", metaKey: true, altKey: true }, key: "[" },
    { event: { key: "‘", code: "BracketRight", metaKey: true, altKey: true }, key: "]" },
  ])("shortcut recording retains the upstream bracket key for $event.key", (row) => {
    expect(keyFromKeyboardEvent(new KeyboardEvent("keydown", row.event))).toBe(row.key)
  })

  // IS_MAC is fixed when the module loads, so each assertion accepts either platform's symbols.
  test("formatKeybind returns human readable output for the first combo", () => {
    const display = formatKeybind("ctrl+alt+arrowup")

    expect(display).toContain("↑")
    expect(display.includes("Ctrl") || display.includes("⌃")).toBe(true)
    expect(display.includes("Alt") || display.includes("⌥")).toBe(true)
    expect(formatKeybind("none")).toBe("")
    expect(formatKeybind("mod+k,mod+p")).toContain("K")
    expect(formatKeybind("mod+k,mod+p")).not.toContain("P")
  })
})
