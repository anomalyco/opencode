import { describe, expect, test } from "bun:test"
import { promptKeyOwner, type PromptKey } from "./prompt-keys"

// A chord as the platform writes it: "mod" is Command on macOS and Ctrl elsewhere.
const press = (chord: string, mac: boolean): PromptKey => {
  const parts = chord.split("+")
  const key = parts.at(-1) === "" ? "+" : (parts.at(-1) ?? "")
  const has = (name: string) => parts.slice(0, -1).includes(name)

  return {
    key,
    ctrlKey: has("Ctrl") || (!mac && has("mod")),
    metaKey: has("Cmd") || (mac && has("mod")),
    altKey: has("Alt"),
    shiftKey: has("Shift"),
    isComposing: false,
  }
}

const owner = (chord: string, mac: boolean, inside = true) => promptKeyOwner(press(chord, mac), { inside, mac })

describe("keys inside an open page prompt", () => {
  for (const mac of [false, true]) {
    const os = mac ? "macOS" : "Windows and Linux"

    test(`answer and move within the prompt on ${os}`, () => {
      for (const chord of ["Enter", "Escape", "Tab", "Shift+Tab"]) expect(owner(chord, mac)).toBe("prompt")
    })

    test(`edit its field as text fields do on ${os}`, () => {
      for (const chord of ["a", "Z", " ", "Backspace", "ArrowLeft", "Shift+Home", "mod+a", "mod+c", "mod+x", "mod+v", "mod+z", "Shift+mod+z", "mod+Backspace"])
        expect(owner(chord, mac)).toBe("field")
    })

    test(`never run the app's or the pane's shortcuts behind it on ${os}`, () => {
      // Reload, the agent switch, find, address field, close and new tab, zoom, palette, model picker, back.
      for (const chord of ["mod+r", "mod+.", "mod+f", "mod+l", "mod+w", "mod+t", "mod+=", "mod++", "mod+-", "mod+0", "Shift+mod+p", "mod+k", "mod+'", "F5", "F3", "F6", "Shift+mod+r"])
        expect(owner(chord, mac), chord).toBe("swallowed")
    })

    test(`leave the window's own keys to the window on ${os}`, () => {
      for (const chord of ["Shift+mod+w", "Shift+mod+n"]) expect(owner(chord, mac)).toBe("window")
    })

    test(`leave every key to the app when the keyboard is elsewhere on ${os}`, () => {
      for (const chord of ["mod+r", "mod+.", "Escape", "Enter", "a"]) expect(owner(chord, mac, false)).toBe("app")
    })
  }

  test("Windows keeps Alt for history and menus, macOS edits text with Option and Control", () => {
    expect(owner("Alt+ArrowLeft", false)).toBe("swallowed")
    expect(owner("Ctrl+y", false)).toBe("field")
    expect(owner("Alt+ArrowLeft", true)).toBe("field")
    expect(owner("Ctrl+a", true)).toBe("field")
    expect(owner("Ctrl+Tab", true)).toBe("swallowed")
    expect(owner("Cmd+ArrowLeft", true)).toBe("field")
    expect(owner("Cmd+[", true)).toBe("swallowed")

    for (const chord of ["Cmd+q", "Cmd+h", "Cmd+Alt+h", "Cmd+m", "Ctrl+Cmd+f"]) expect(owner(chord, true)).toBe("window")
  })

  test("a key that composes text is the field's", () => {
    expect(promptKeyOwner({ ...press("Enter", false), isComposing: true }, { inside: true, mac: false })).toBe("field")
  })
})
