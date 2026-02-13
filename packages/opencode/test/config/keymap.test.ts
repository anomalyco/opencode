import { describe, expect, test } from "bun:test"
import { Keymap } from "../../src/config/keymap"

describe("Keymap", () => {
  test("Names contains expected presets", () => {
    expect(Keymap.Names).toContain("default")
    expect(Keymap.Names).toContain("emacs")
    expect(Keymap.Names).toContain("vim")
  })

  test("get returns empty object for default", () => {
    const preset = Keymap.get("default")
    expect(preset).toEqual({})
  })

  test("get returns emacs preset with expected keys", () => {
    const preset = Keymap.get("emacs")
    expect(preset.leader).toBe("ctrl+x")
    expect(preset.command_list).toBe("alt+x,ctrl+p")
    expect(preset.session_interrupt).toBe("ctrl+g,escape")
  })

  test("get returns vim preset with space leader", () => {
    const preset = Keymap.get("vim")
    expect(preset.leader).toBe("space")
    expect(preset.messages_undo).toBe("u,<leader>u")
    expect(preset.messages_redo).toBe("ctrl+r,<leader>r")
  })

  test("describe returns description for each keymap", () => {
    expect(Keymap.describe("default")).toContain("Default")
    expect(Keymap.describe("emacs")).toContain("Emacs")
    expect(Keymap.describe("vim")).toContain("Vim")
  })

  test("hints returns array of hints for each keymap", () => {
    for (const name of Keymap.Names) {
      const hints = Keymap.hints(name)
      expect(Array.isArray(hints)).toBe(true)
      expect(hints.length).toBeGreaterThan(0)
      expect(hints[0]).toContain("Leader")
    }
  })

  test("apply merges preset with user keybinds", () => {
    const userKeybinds = {
      leader: "ctrl+x",
      app_exit: "ctrl+q",
    }
    const result = Keymap.apply("vim", userKeybinds as any)
    // User override takes precedence
    expect(result.leader).toBe("ctrl+x")
    expect(result.app_exit).toBe("ctrl+q")
    // Vim preset values still present where not overridden
    expect(result.messages_undo).toBe("u,<leader>u")
  })

  test("apply with default keymap just returns user keybinds", () => {
    const userKeybinds = {
      leader: "ctrl+a",
      app_exit: "ctrl+q",
    }
    const result = Keymap.apply("default", userKeybinds as any)
    expect(result.leader).toBe("ctrl+a")
    expect(result.app_exit).toBe("ctrl+q")
  })
})
