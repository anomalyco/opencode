import { describe, test, expect } from "bun:test"
import { Keybind } from "../src/util/keybind"

describe("Keybind.toString", () => {
  test("should convert simple key to string", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "f" }
    expect(Keybind.toString(info)).toBe("f")
  })

  test("should convert ctrl modifier to string", () => {
    const info: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "x" }
    expect(Keybind.toString(info)).toBe("ctrl+x")
  })

  test("should convert leader key to string", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "f" }
    expect(Keybind.toString(info)).toBe("<leader> f")
  })

  test("should convert multiple modifiers to string", () => {
    const info: Keybind.Info = { ctrl: true, meta: true, shift: false, leader: false, name: "g" }
    expect(Keybind.toString(info)).toBe("ctrl+alt+g")
  })

  test("should convert all modifiers to string", () => {
    const info: Keybind.Info = { ctrl: true, meta: true, shift: true, leader: true, name: "h" }
    expect(Keybind.toString(info)).toBe("<leader> ctrl+alt+shift+h")
  })

  test("should convert shift modifier to string", () => {
    const info: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: true,
      leader: false,
      name: "return",
    }
    expect(Keybind.toString(info)).toBe("shift+return")
  })

  test("should convert function key to string", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "f2" }
    expect(Keybind.toString(info)).toBe("f2")
  })

  test("should convert special key to string", () => {
    const info: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "pgup",
    }
    expect(Keybind.toString(info)).toBe("pgup")
  })

  test("should handle empty name", () => {
    const info: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "" }
    expect(Keybind.toString(info)).toBe("ctrl")
  })

  test("should handle only modifiers", () => {
    const info: Keybind.Info = { ctrl: true, meta: true, shift: true, leader: true, name: "" }
    expect(Keybind.toString(info)).toBe("<leader> ctrl+alt+shift")
  })

  test("should handle only leader with no other parts", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "" }
    expect(Keybind.toString(info)).toBe("<leader>")
  })

  test("should convert super modifier to string", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: false, super: true, leader: false, name: "z" }
    expect(Keybind.toString(info)).toBe("super+z")
  })

  test("should convert super+shift modifier to string", () => {
    const info: Keybind.Info = { ctrl: false, meta: false, shift: true, super: true, leader: false, name: "z" }
    expect(Keybind.toString(info)).toBe("super+shift+z")
  })

  test("should handle super with ctrl modifier", () => {
    const info: Keybind.Info = { ctrl: true, meta: false, shift: false, super: true, leader: false, name: "a" }
    expect(Keybind.toString(info)).toBe("ctrl+super+a")
  })

  test("should handle super with all modifiers", () => {
    const info: Keybind.Info = { ctrl: true, meta: true, shift: true, super: true, leader: false, name: "x" }
    expect(Keybind.toString(info)).toBe("ctrl+alt+super+shift+x")
  })

  test("should handle undefined super field (omitted)", () => {
    const info: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "c" }
    expect(Keybind.toString(info)).toBe("ctrl+c")
  })
})

describe("Keybind.match", () => {
  test("should match identical keybinds", () => {
    const a: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "x" }
    const b: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "x" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should not match different key names", () => {
    const a: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "x" }
    const b: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "y" }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("should not match different modifiers", () => {
    const a: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "x" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "x" }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("should match leader keybinds", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "f" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "f" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should not match leader vs non-leader", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "f" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "f" }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("should match complex keybinds", () => {
    const a: Keybind.Info = { ctrl: true, meta: true, shift: false, leader: false, name: "g" }
    const b: Keybind.Info = { ctrl: true, meta: true, shift: false, leader: false, name: "g" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should not match with one modifier different", () => {
    const a: Keybind.Info = { ctrl: true, meta: true, shift: false, leader: false, name: "g" }
    const b: Keybind.Info = { ctrl: true, meta: true, shift: true, leader: false, name: "g" }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("should match simple key without modifiers", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "a" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: false, name: "a" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should match super modifier keybinds", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: false, super: true, leader: false, name: "z" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, super: true, leader: false, name: "z" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should not match super vs non-super", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: false, super: true, leader: false, name: "z" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: false, super: false, leader: false, name: "z" }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("should match undefined super with false super", () => {
    const a: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "c" }
    const b: Keybind.Info = { ctrl: true, meta: false, shift: false, super: false, leader: false, name: "c" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should match super+shift combination", () => {
    const a: Keybind.Info = { ctrl: false, meta: false, shift: true, super: true, leader: false, name: "z" }
    const b: Keybind.Info = { ctrl: false, meta: false, shift: true, super: true, leader: false, name: "z" }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("should not match when only super differs", () => {
    const a: Keybind.Info = { ctrl: true, meta: true, shift: true, super: true, leader: false, name: "a" }
    const b: Keybind.Info = { ctrl: true, meta: true, shift: true, super: false, leader: false, name: "a" }
    expect(Keybind.match(a, b)).toBe(false)
  })
})

describe("Keybind.parse", () => {
  test("should parse simple key", () => {
    const result = Keybind.parse("f")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: false,
        name: "f",
      },
    ])
  })

  test("should parse leader key syntax", () => {
    const result = Keybind.parse("<leader>f")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "f",
      },
    ])
  })

  test("should parse ctrl modifier", () => {
    const result = Keybind.parse("ctrl+x")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: false,
        shift: false,
        leader: false,
        name: "x",
      },
    ])
  })

  test("should parse multiple modifiers", () => {
    const result = Keybind.parse("ctrl+alt+u")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: true,
        shift: false,
        leader: false,
        name: "u",
      },
    ])
  })

  test("should parse shift modifier", () => {
    const result = Keybind.parse("shift+f2")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: true,
        leader: false,
        name: "f2",
      },
    ])
  })

  test("should parse meta/alt modifier", () => {
    const result = Keybind.parse("meta+g")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: true,
        shift: false,
        leader: false,
        name: "g",
      },
    ])
  })

  test("should parse leader with modifier", () => {
    const result = Keybind.parse("<leader>h")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "h",
      },
    ])
  })

  test("should parse multiple keybinds separated by comma", () => {
    const result = Keybind.parse("ctrl+c,<leader>q")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: false,
        shift: false,
        leader: false,
        name: "c",
      },
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "q",
      },
    ])
  })

  test("should parse shift+return combination", () => {
    const result = Keybind.parse("shift+return")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: true,
        leader: false,
        name: "return",
      },
    ])
  })

  test("should parse ctrl+j combination", () => {
    const result = Keybind.parse("ctrl+j")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: false,
        shift: false,
        leader: false,
        name: "j",
      },
    ])
  })

  test("should handle 'none' value", () => {
    const result = Keybind.parse("none")
    expect(result).toEqual([])
  })

  test("should handle special keys", () => {
    const result = Keybind.parse("pgup")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: false,
        name: "pgup",
      },
    ])
  })

  test("should handle function keys", () => {
    const result = Keybind.parse("f2")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: false,
        name: "f2",
      },
    ])
  })

  test("should handle complex multi-modifier combination", () => {
    const result = Keybind.parse("ctrl+alt+g")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: true,
        shift: false,
        leader: false,
        name: "g",
      },
    ])
  })

  test("should be case insensitive", () => {
    const result = Keybind.parse("CTRL+X")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: false,
        shift: false,
        leader: false,
        name: "x",
      },
    ])
  })

  test("should parse super modifier", () => {
    const result = Keybind.parse("super+z")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        super: true,
        leader: false,
        name: "z",
      },
    ])
  })

  test("should parse super with shift modifier", () => {
    const result = Keybind.parse("super+shift+z")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: true,
        super: true,
        leader: false,
        name: "z",
      },
    ])
  })

  test("should parse multiple keybinds with super", () => {
    const result = Keybind.parse("ctrl+-,super+z")
    expect(result).toEqual([
      {
        ctrl: true,
        meta: false,
        shift: false,
        leader: false,
        name: "-",
      },
      {
        ctrl: false,
        meta: false,
        shift: false,
        super: true,
        leader: false,
        name: "z",
      },
    ])
  })

  test("should parse leader with closing bracket", () => {
    const result = Keybind.parse("<leader>],alt+]")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "]",
      },
      {
        ctrl: false,
        meta: true,
        shift: false,
        leader: false,
        name: "]",
      },
    ])
  })

  test("should parse leader with opening bracket", () => {
    const result = Keybind.parse("<leader>[,alt+[")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "[",
      },
      {
        ctrl: false,
        meta: true,
        shift: false,
        leader: false,
        name: "[",
      },
    ])
  })

  test("should trim whitespace around comma-separated keybinds", () => {
    const result = Keybind.parse(" <leader>] , alt+] ")
    expect(result).toEqual([
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "]",
      },
      {
        ctrl: false,
        meta: true,
        shift: false,
        leader: false,
        name: "]",
      },
    ])
  })

  test("should match parsed leader bracket with simulated event", () => {
    const parsed = Keybind.parse("<leader>]")
    const event: Keybind.Info = { ctrl: false, meta: false, shift: false, leader: true, name: "]" }
    expect(Keybind.match(parsed[0], event)).toBe(true)
  })
})

describe("Keybind.normalizeLeaderKey", () => {
  const base = {
    ctrl: false,
    meta: false,
    shift: false,
    super: false,
    option: false,
    number: false,
    sequence: "",
    raw: "",
    eventType: "press",
    source: "raw",
  } as const

  test("should map linefeed to j", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "linefeed" })
    expect(result.name).toBe("j")
    expect(result.ctrl).toBe(false)
  })

  test("should map escape to [", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "escape" })
    expect(result.name).toBe("[")
    expect(result.ctrl).toBe(false)
  })

  test("should map return to m", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "return" })
    expect(result.name).toBe("m")
    expect(result.ctrl).toBe(false)
  })

  test("should map tab to i", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "tab" })
    expect(result.name).toBe("i")
    expect(result.ctrl).toBe(false)
  })

  test("should map backspace to h", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "backspace" })
    expect(result.name).toBe("h")
    expect(result.ctrl).toBe(false)
  })

  test("should strip ctrl from single-letter key", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "k", ctrl: true })
    expect(result.name).toBe("k")
    expect(result.ctrl).toBe(false)
  })

  test("should pass through plain letter unchanged", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "j" })
    expect(result.name).toBe("j")
    expect(result.ctrl).toBe(false)
  })

  test("should not strip ctrl from multi-char names like f2", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "f2", ctrl: true })
    expect(result.name).toBe("f2")
    expect(result.ctrl).toBe(true)
  })

  test("should preserve other modifiers when mapping control chars", () => {
    const result = Keybind.normalizeLeaderKey({ ...base, name: "linefeed", shift: true })
    expect(result.name).toBe("j")
    expect(result.ctrl).toBe(false)
    expect(result.shift).toBe(true)
  })
})
