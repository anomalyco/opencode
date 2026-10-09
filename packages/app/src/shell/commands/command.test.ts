import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  activeCommandRegistrations,
  addCommandRegistration,
  commandPaletteOptions,
  CommandCatalog,
  formatKeybind,
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
  })

  expect(catalog).toEqual({
    open: { title: "Open", keybind: "mod+o", hidden: false },
    shell: { title: "Terminal", section: "terminal" },
    stale: { title: "Stale" },
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
    // macOS Option turns L into ¬; the physical key still matches.
    { config: "meta+alt+l", event: { key: "¬", code: "KeyL", metaKey: true, altKey: true }, match: true },
  ])("matchKeybind $config with $event.key is $match", (row) => {
    expect(matchKeybind(parseKeybind(row.config), new KeyboardEvent("keydown", row.event))).toBe(row.match)
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
