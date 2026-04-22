import { describe, expect, it } from "bun:test"
import { parse, toString } from "../../src/util/keybind"

it("parse recognizes cmd as alias for super", () => {
  const result = parse("cmd+k")
  expect(result).toHaveLength(1)
  expect(result[0]!.super).toBe(true)
  expect(result[0]!.name).toBe("k")
})

it("parse recognizes command as alias for super", () => {
  const result = parse("command+shift+a")
  expect(result).toHaveLength(1)
  expect(result[0]!.super).toBe(true)
  expect(result[0]!.shift).toBe(true)
  expect(result[0]!.name).toBe("a")
})

it("toString displays super key", () => {
  const result = toString({ ctrl: false, meta: false, shift: false, super: true, leader: false, name: "k" })
  expect(result).toMatch(/^(cmd|super)\+k$/)
})