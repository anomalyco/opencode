import { describe, expect, test } from "bun:test"
import { budget, wrap } from "../../../src/cli/cmd/tui/ui/dialog-select-budget"

describe("dialog-select budget", () => {
  test("caps width to max", () => {
    expect(budget(200, 0, 2)).toBe(122)
  })

  test("scales with width", () => {
    expect(budget(40, 0, 2)).toBe(60)
    expect(budget(40, 0, 1)).toBe(61)
  })

  test("clamps to minimum", () => {
    expect(budget(0, 0, 1)).toBe(1)
  })

  test("subtracts footer length for strings", () => {
    const tail = "tail".length + 1
    expect(budget(40, tail, 2)).toBe(50)
  })

  test("supports explicit reserved width", () => {
    expect(budget(40, 10, 2)).toBe(40)
  })

  test("keeps single-line budget constant", () => {
    expect(budget(40, 10, 1)).toBe(61)
  })

  test("wraps to two lines with ellipsis", () => {
    const text = "one two three four five six seven eight nine ten"
    const result = wrap(text, 20, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.at(-1) ?? "").toContain("...")
  })

  test("wrap respects reserved width", () => {
    const text = "one two three four five six seven"
    const result = wrap(text, 20, 5, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => line.length <= 5)).toBe(true)
  })

  test("wrap preserves whitespace when text already fits", () => {
    expect(wrap("Foo  Bar", 20, 0, 2)).toBe("Foo  Bar")
  })

  test("wrap preserves repeated spaces when wrapping", () => {
    const result = wrap("Foo    Bar baz qux quux corge", 20, 0, 2)
    expect(result.startsWith("Foo    Bar")).toBe(true)
  })

  test("wraps text that only fits across multiple lines", () => {
    const result = wrap("123456 123456", 20, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 10)).toBe(true)
  })

  test("wrap does not carry whitespace to the next line", () => {
    const result = wrap("12345 12 34567 x", 15, 0, 3)
    expect(result.split("\n").every((line) => !line.startsWith(" "))).toBe(true)
  })

  test("wrap normalizes hard whitespace before enforcing max lines", () => {
    const result = wrap("a\nb\nc\nd\ne", 15, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 5)).toBe(true)
  })

  test("wrap respects display width for CJK", () => {
    const result = wrap("你好世界 你好世界 你好世界", 20, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 10)).toBe(true)
  })

  test("wrap chunks wide tokens by display width", () => {
    const result = wrap("你好你好你好你好你好你好", 20, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => Bun.stringWidth(line) <= 10)).toBe(true)
  })

  test("wrap reserves jsx footer width plus row gap", () => {
    const reservedWidth = Bun.stringWidth("git: repo") + 3
    const result = wrap("one two three four five", 24, reservedWidth, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.every((line) => line.length <= 24 - 10 - reservedWidth)).toBe(true)
  })

  test("wrap chunks long tokens", () => {
    const text = "supercalifragilisticexpialidocious"
    const result = wrap(text, 20, 0, 2)
    const lines = result.split("\n")
    expect(lines.length).toBe(2)
    expect(lines.at(-1) ?? "").toContain("...")
  })
})
