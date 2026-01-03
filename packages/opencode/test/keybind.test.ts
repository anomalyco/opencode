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
        baseCode: 102,
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
        baseCode: 102,
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
        baseCode: 120,
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
        baseCode: 117,
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
        baseCode: undefined,
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
        baseCode: 103,
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
        baseCode: 104,
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
        baseCode: 99,
      },
      {
        ctrl: false,
        meta: false,
        shift: false,
        leader: true,
        name: "q",
        baseCode: 113,
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
        baseCode: undefined,
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
        baseCode: 106,
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
        baseCode: undefined,
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
        baseCode: undefined,
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
        baseCode: 103,
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
        baseCode: 120,
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
        baseCode: 122,
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
        baseCode: 122,
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
        baseCode: 45,
      },
      {
        ctrl: false,
        meta: false,
        shift: false,
        super: true,
        leader: false,
        name: "z",
        baseCode: 122,
      },
    ])
  })

  test("should generate baseCode for single ASCII characters", () => {
    const result = Keybind.parse("ctrl+x")
    expect(result[0].baseCode).toBe(120)
  })

  test("should not generate baseCode for special keys", () => {
    const result = Keybind.parse("ctrl+return")
    expect(result[0].baseCode).toBeUndefined()
  })

  test("should not generate baseCode for function keys", () => {
    const result = Keybind.parse("f2")
    expect(result[0].baseCode).toBeUndefined()
  })
})

describe("Keybind.match with physical keys", () => {
  test("should match by baseCode when usePhysicalKeys is true", () => {
    const config: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      baseCode: 120,
    }
    const input: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "ㅌ",
      baseCode: 120,
    }
    expect(Keybind.match(config, input, { usePhysicalKeys: true })).toBe(true)
  })

  test("should not match different baseCode with usePhysicalKeys", () => {
    const a: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      baseCode: 120,
    }
    const b: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "y",
      baseCode: 121,
    }
    expect(Keybind.match(a, b, { usePhysicalKeys: true })).toBe(false)
  })

  test("should fallback to name matching when baseCode unavailable", () => {
    const a: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      baseCode: undefined,
    }
    const b: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      baseCode: undefined,
    }
    expect(Keybind.match(a, b, { usePhysicalKeys: true })).toBe(true)
  })

  test("should use character matching when usePhysicalKeys is false", () => {
    const config: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      baseCode: 120,
    }
    const input: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "ㅌ",
      baseCode: 120,
    }
    expect(Keybind.match(config, input, { usePhysicalKeys: false })).toBe(false)
  })

  test("should match AZERTY layout (Q key produces 'a')", () => {
    const config: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "q",
      baseCode: 113,
    }
    const input: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      baseCode: 113,
    }
    expect(Keybind.match(config, input, { usePhysicalKeys: true })).toBe(true)
  })

  test("should match modifiers correctly with physical keys", () => {
    const a: Keybind.Info = {
      ctrl: true,
      meta: true,
      shift: false,
      leader: false,
      name: "x",
      baseCode: 120,
    }
    const b: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "ㅌ",
      baseCode: 120,
    }
    expect(Keybind.match(a, b, { usePhysicalKeys: true })).toBe(false)
  })

  test("should match leader key with physical keys", () => {
    const a: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: true,
      name: "n",
      baseCode: 110,
    }
    const b: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: true,
      name: "ㅜ",
      baseCode: 110,
    }
    expect(Keybind.match(a, b, { usePhysicalKeys: true })).toBe(true)
  })

  test("should not match when leader differs with physical keys", () => {
    const a: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: true,
      name: "n",
      baseCode: 110,
    }
    const b: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "ㅜ",
      baseCode: 110,
    }
    expect(Keybind.match(a, b, { usePhysicalKeys: true })).toBe(false)
  })
})

describe("Keybind.fromParsedKey with baseCode", () => {
  test("should preserve baseCode from ParsedKey", () => {
    const parsedKey = {
      name: "ㅌ",
      ctrl: true,
      meta: false,
      shift: false,
      baseCode: 120,
    } as any

    const info = Keybind.fromParsedKey(parsedKey)
    expect(info.baseCode).toBe(120)
  })

  test("should handle undefined baseCode", () => {
    const parsedKey = {
      name: "x",
      ctrl: true,
      meta: false,
      shift: false,
    } as any

    const info = Keybind.fromParsedKey(parsedKey)
    expect(info.baseCode).toBeUndefined()
  })
})
