import { expect, test } from "bun:test"
import { agentKeyRefusal, hardwareInput, pageLetter, pageReload, pageShortcut, type PageKey } from "./keys"

test("only hardware input can run shell shortcuts, even while a CDP command is pending", () => {
  expect(hardwareInput({ type: "keyDown", _modifiers: 2 })).toBe(true)
  expect(hardwareInput({ type: "keyDown", _modifiers: (1 << 23) | 2 })).toBe(false)
  expect(hardwareInput({ type: "keyDown" })).toBe(false)
})

test("agent key dispatch leaves the system clipboard and native menus to the user", () => {
  for (const [key, flags] of [["V", 2], ["v", 4], ["c", 10], ["C", 4], ["X", 2], ["x", 4], ["Insert", 8], ["Insert", 2], ["Delete", 8], ["F10", 8], ["ContextMenu", 0]] as const)
    expect(agentKeyRefusal(key, flags)).toContain("fill")

  for (const [key, flags] of [["A", 2], ["A", 4], ["v", 0], ["Delete", 0], ["Enter", 0]] as const)
    expect(agentKeyRefusal(key, flags)).toBeUndefined()
})

/** A key press with `mod` as the platform's modifier: Command on macOS, Control elsewhere. */
const press = (modifiers: string, key: string, mac: boolean, code = ""): PageKey => {
  const held = modifiers.split("+")
  const mod = held.includes("mod")

  return {
    key,
    code,
    control: held.includes("ctrl") || (mod && !mac),
    meta: mod && mac,
    shift: held.includes("shift"),
    alt: held.includes("alt"),
  }
}

test.each([
  { layout: "QWERTY", input: { key: "C", code: "KeyC" }, letter: "c" },
  // Dvorak types C on the physical I key; Chromium reports the physical key as the code.
  { layout: "Dvorak", input: { key: "C", code: "KeyI" }, letter: "c" },
  { layout: "Dvorak", input: { key: "l", code: "KeyP" }, letter: "l" },
  // Dvorak's J sits where QWERTY has C, so it must not open the picker.
  { layout: "Dvorak", input: { key: "J", code: "KeyC" }, letter: "j" },
  { layout: "Russian", input: { key: "\u0421", code: "KeyC" }, letter: "c" },
  { layout: "QWERTY", input: { key: "=", code: "Equal" }, letter: "=" },
  { layout: "QWERTY", input: { key: "{", code: "BracketLeft" }, letter: "[" },
  // Dvorak types brackets on the physical minus and equal keys, and slash on the physical left bracket.
  { layout: "Dvorak", input: { key: "}", code: "Equal" }, letter: "]" },
  { layout: "Dvorak", input: { key: "/", code: "BracketLeft" }, letter: "/" },
  { layout: "Russian", input: { key: "\u0445", code: "BracketLeft" }, letter: "[" },
])("$layout $input.key on $input.code is $letter", (row) => {
  expect(pageLetter(row.input)).toBe(row.letter)
})

test("forwards browser and shell shortcuts while leaving page editing, reload and in-page chords to the page", () => {
  const cases: [modifiers: string, key: string, mac: boolean, forwarded: string | undefined, code?: string][] = [
    // Browser tab, window and shell chords forwarded from the page.
    ["mod", "g", true, "g"], ["mod+shift", "G", true, "g"],
    ["mod", "g", false, "g"], ["mod+shift", "G", false, "g"],
    ["", "F3", false, "F3"], ["shift", "F3", false, "F3"],
    ["", "F3", true, undefined], ["ctrl", "g", true, undefined],
    ["mod", "t", true, "t"],
    ["mod", "t", false, "t"],
    // Dvorak: T is on the physical K key and Y on the physical T key; the character decides.
    ["mod", "t", true, "t", "KeyK"],
    ["mod", "y", true, undefined, "KeyT"],
    ["mod", "w", true, "w"],
    ["mod", "w", false, "w"],
    ["mod", "\u0432", true, "w", "KeyW"],
    // The address field, as in a browser.
    ["mod", "l", true, "l"],
    ["mod", "l", false, "l"],
    ["mod", "l", true, "l", "KeyP"],
    ["mod", "n", true, "n"],
    ["mod", "n", false, "n"],
    ["mod", "1", true, "1"],
    ["mod", "9", false, "9"],
    ["mod", ",", true, ","],
    ["mod", "\\", false, "\\"],
    ["mod+shift", "T", true, "t"],
    ["mod+shift", "R", true, "r"],
    ["mod+shift", "R", false, "r"], ["mod", "F5", false, "F5"], ["mod+alt", "r", true, "r"],
    ["mod+shift", "P", true, "p"],
    ["mod+shift", "M", true, "m"],
    ["mod+shift", "M", false, "m"],
    ["mod", "m", true, undefined],
    ["mod+shift", "L", true, "l"],
    ["mod+shift", "E", true, "e"],
    ["mod+shift", "{", true, "[", "BracketLeft"],
    ["mod+shift", "}", false, "]", "BracketRight"],
    ["mod+alt", "ArrowLeft", true, "ArrowLeft"],
    ["mod+alt", "ArrowRight", false, "ArrowRight"],
    ["ctrl", "Tab", true, "Tab"],
    ["ctrl+shift", "Tab", false, "Tab"],
    ["ctrl", "`", true, "`"],
    ["ctrl", "`", false, "`"],
    // The side panel's launchers: Review, Browser and Open file.
    ["ctrl+mod", "b", true, "b"],
    ["ctrl+mod", "r", true, "r"],
    ["ctrl+mod", "p", true, "p"],
    ["ctrl+alt", "b", false, "b"],
    ["ctrl+alt", "p", false, "p"],
    // AltGr typing on Windows and Linux layouts arrives as Ctrl+Alt with the character it types.
    ["ctrl+alt", "\u00a7", false, undefined, "KeyP"],
    ["ctrl+mod", "k", true, undefined],
    // New Window and Close Window belong to native menu accelerators, which a claimed chord would block.
    ["mod+shift", "W", true, undefined],
    ["mod+shift", "W", false, undefined],
    ["mod+shift", "N", true, undefined],
    ["mod+shift", "N", false, undefined],
    // In-page editor chords (link/command menu, bold, italic, save) stay with the page.
    ["mod", "k", true, undefined],
    ["mod", "k", false, undefined],
    ["mod", "b", true, undefined],
    ["mod", "i", true, undefined],
    ["mod", "s", true, undefined],
    // Clipboard, select all, undo and redo stay with the page.
    ["mod", "c", true, undefined],
    ["mod", "x", true, undefined],
    ["mod", "v", true, undefined],
    ["mod+shift", "V", true, undefined],
    ["mod", "a", true, undefined],
    ["mod", "z", true, undefined],
    ["mod+shift", "Z", true, undefined],
    ["mod", "c", false, undefined],
    ["mod", "v", false, undefined],
    ["mod", "a", false, undefined],
    ["mod", "z", false, undefined],
    ["mod", "y", false, undefined],
    // Find, reload, history, and the pane's own picker and zoom chords.
    ["mod", "f", true, "f"],
    ["mod", "f", false, "f"],
    ["mod", "r", true, undefined],
    ["mod", "r", false, undefined],
    ["mod", "[", true, undefined],
    ["mod", "]", true, undefined],
    ["mod+shift", "C", true, undefined],
    ["mod", "=", true, undefined],
    ["mod", "-", true, undefined],
    ["mod", "0", false, undefined],
    // Caret movement, macOS Control keys, and plain typing.
    ["mod", "ArrowLeft", true, undefined],
    ["mod+shift", "ArrowRight", false, undefined],
    ["mod", "Backspace", false, undefined],
    ["ctrl", "b", true, undefined],
    ["ctrl+shift", "E", true, undefined],
    ["", "k", true, undefined],
    ["shift", "Tab", true, undefined],
  ]

  const results = cases.map(([modifiers, key, mac, , code]) => [
    modifiers,
    key,
    mac,
    pageShortcut(press(modifiers, key, mac, code), mac, true)?.key,
  ])

  expect(results).toEqual(cases.map(([modifiers, key, mac, forwarded]) => [modifiers, key, mac, forwarded]))
})

test("leaves the device toolbar chord to the page in builds without the toolbar", () => {
  expect(pageShortcut(press("mod+shift", "M", true), true, false)).toBeUndefined()
  expect(pageShortcut(press("mod+shift", "M", false), false, false)).toBeUndefined()
  expect(pageShortcut(press("mod+shift", "T", true), true, false)?.key).toBe("t")
})

test("reloads the focused page on F5 and the platform's reload chord, leaving other R chords to the window", () => {
  const cases: [modifiers: string, key: string, mac: boolean, reloads: ReturnType<typeof pageReload>, code?: string][] = [
    ["", "F5", true, true],
    ["", "F5", false, true],
    ["mod", "r", true, true],
    ["mod", "r", false, true],
    // Dvorak: R is on the physical O key; the character decides.
    ["mod", "r", true, true, "KeyO"],
    ["mod", "\u043a", true, true, "KeyR"],
    ["mod+shift", "R", true, false],
    ["mod+shift", "R", false, false],
    ["mod", "F5", false, false],
    ["mod+alt", "r", true, false],
    ["ctrl", "r", true, false],
    ["mod", "F5", true, false],
    ["ctrl", "F5", true, false],
    ["", "r", true, false],
  ]

  const results = cases.map(([modifiers, key, mac, , code]) => [
    modifiers,
    key,
    mac,
    pageReload(press(modifiers, key, mac, code), mac),
  ])

  expect(results).toEqual(cases.map(([modifiers, key, mac, reloads]) => [modifiers, key, mac, reloads]))
})
