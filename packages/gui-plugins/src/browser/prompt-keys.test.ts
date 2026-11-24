import { describe, expect, test } from "bun:test"
import { promptKeyOwner, type PromptKey } from "./prompt-keys"

// A chord as the platform writes it: "mod" is Command on macOS and Ctrl elsewhere. `code` is the physical key, which
// a US layout names after its letter; `as` overrides what the layout reports.
const press = (chord: string, mac: boolean, as: Partial<PromptKey> & { altGraph?: boolean } = {}): PromptKey => {
  const parts = chord.split("+")
  const key = parts.at(-1) === "" ? "+" : (parts.at(-1) ?? "")
  const has = (name: string) => parts.slice(0, -1).includes(name)
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === "`" ? "Backquote" : key

  return {
    key,
    code,
    keyCode: 0,
    ctrlKey: has("Ctrl") || (!mac && has("mod")),
    metaKey: has("Cmd") || (mac && has("mod")),
    altKey: has("Alt"),
    shiftKey: has("Shift"),
    isComposing: false,
    getModifierState: (state) => state === "AltGraph" && !!as.altGraph,
    ...as,
  }
}

const owner = (chord: string, mac: boolean, input: { inside?: boolean; text?: boolean; as?: Partial<PromptKey> & { altGraph?: boolean } } = {}) =>
  promptKeyOwner(press(chord, mac, input.as), { inside: input.inside ?? true, mac, text: input.text ?? true })

describe("keys inside an open page prompt", () => {
  for (const mac of [false, true]) {
    const os = mac ? "macOS" : "Windows and Linux"

    test(`answer and move within the prompt on ${os}`, () => {
      for (const chord of ["Enter", "Escape", "Tab", "Shift+Tab"]) expect(owner(chord, mac)).toBe("prompt")
    })

    test(`edit its field as text fields do on ${os}`, () => {
      for (const chord of ["a", "Z", " ", "Backspace", "ArrowLeft", "Shift+Home", "mod+a", "mod+c", "mod+x", "mod+v", "mod+z", "Shift+mod+z", "Shift+mod+v", "mod+Backspace", "Shift+mod+ArrowLeft"])
        expect(owner(chord, mac), chord).toBe("field")
    })

    test(`never run the app's or the pane's shortcuts behind it on ${os}`, () => {
      // Reload, the agent switch, find, address field, close and new tab, zoom, palette, model picker, back, and the
      // editing letters with a Shift that edits nothing (select an element, a new incognito-style window).
      for (const chord of ["mod+r", "mod+.", "mod+f", "mod+w", "mod+t", "mod+=", "mod++", "mod+-", "mod+0", "Shift+mod+p", "mod+k", "mod+'", "F5", "F3", "Shift+mod+r", "Shift+mod+a", "Shift+mod+c", "Shift+mod+x", "Shift+mod+l"])
        expect(owner(chord, mac), chord).toBe("swallowed")
    })

    test(`leave the prompt open for the address field on F6 and the address shortcut on ${os}`, () => {
      for (const chord of ["F6", "Shift+F6", "mod+l"]) expect(owner(chord, mac), chord).toBe("exit")
      expect(owner("mod+д", mac, { as: { code: "KeyL" } })).toBe("exit")
    })

    test(`leave the window's own keys to the window on ${os}`, () => {
      for (const chord of ["Shift+mod+w", "Shift+mod+n"]) expect(owner(chord, mac)).toBe("window")
    })

    test(`leave every key to the app when the keyboard is elsewhere on ${os}`, () => {
      for (const chord of ["mod+r", "mod+.", "Escape", "Enter", "a"]) expect(owner(chord, mac, { inside: false })).toBe("app")
    })

    test(`keep a key that ends an IME composition in the field on ${os}`, () => {
      expect(owner("Enter", mac, { as: { isComposing: true } })).toBe("field")
      // Chromium already reports isComposing false for the key that commits or cancels the composition.
      expect(owner("Enter", mac, { as: { keyCode: 229 } })).toBe("field")
      expect(owner("Escape", mac, { as: { keyCode: 229 } })).toBe("field")
    })

    test(`paste, select all and undo on a layout without Latin letters on ${os}`, () => {
      // A Russian layout names the V, A, Z and C keys by their Cyrillic letters.
      for (const [key, code] of [["м", "KeyV"], ["ф", "KeyA"], ["я", "KeyZ"], ["с", "KeyC"]])
        expect(owner(`mod+${key}`, mac, { as: { code } }), key).toBe("field")
      expect(owner("mod+к", mac, { as: { code: "KeyR" } })).toBe("swallowed")
    })
  }

  test("AltGr types a layout's characters on Windows and Linux", () => {
    // German @ and {, Polish ą, a French dead key: Windows reports Ctrl+Alt, with or without AltGraph.
    for (const key of ["@", "{", "[", "\\", "€", "ą", "Dead"]) {
      expect(owner(`Ctrl+Alt+${key}`, false, { as: { altGraph: true } }), key).toBe("field")
      expect(owner(`Ctrl+Alt+${key}`, false), key).toBe("field")
    }

    expect(owner("q", false, { as: { key: "@", altGraph: true } })).toBe("field")
    // Ctrl+Alt with no character is still a chord.
    expect(owner("Ctrl+Alt+ArrowLeft", false)).toBe("swallowed")
  })

  test("Windows and Linux keep their system chords", () => {
    expect(owner("Alt+F4", false)).toBe("window")

    for (const chord of ["Shift+F10", "Ctrl+Insert", "Shift+Insert", "Shift+Delete", "ContextMenu", "Ctrl+y"])
      expect(owner(chord, false), chord).toBe("field")
    expect(owner("Alt+ArrowLeft", false)).toBe("swallowed")
    expect(owner("Alt+F", false)).toBe("swallowed")
    expect(owner("Alt+F6", false)).toBe("swallowed")
  })

  test("macOS edits text with Option and Control and keeps its window chords", () => {
    for (const chord of ["Alt+ArrowLeft", "Alt+l", "Alt+e", "Ctrl+a", "Ctrl+e", "Ctrl+k", "Ctrl+b", "Ctrl+f", "Ctrl+d", "Ctrl+h", "Cmd+ArrowLeft", "Ctrl+Cmd+ "])
      expect(owner(chord, true), chord).toBe("field")

    for (const chord of ["Cmd+q", "Cmd+h", "Cmd+Alt+h", "Cmd+m", "Cmd+`", "Shift+Cmd+`", "Ctrl+Cmd+f"]) expect(owner(chord, true), chord).toBe("window")

    for (const chord of ["Ctrl+Tab", "Ctrl+`", "Cmd+[", "Cmd+]", "Cmd+n", "Cmd+,", "Shift+Cmd+b", "Alt+Cmd+i"]) expect(owner(chord, true), chord).toBe("swallowed")
  })

  test("macOS Option+Up and Down move the caret in a field and do nothing elsewhere in the prompt", () => {
    for (const chord of ["Alt+ArrowUp", "Alt+ArrowDown"]) {
      expect(owner(chord, true, { text: true })).toBe("field")
      expect(owner(chord, true, { text: false })).toBe("swallowed")
    }
  })
})
