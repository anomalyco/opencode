import { test, expect } from "bun:test"
import { Text } from "@/terminal/widgets/Text"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"

function cp(ch: string): number { return ch.codePointAt(0) ?? 32 }

test("render single line text", () => {
  const t = new Text()
  t.setBounds(0, 0, 20, 3)
  t.content = "Hello"

  const buffer = new ScreenBuffer(20, 3)
  t.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(cp("H"))
  expect(buffer.getCodePoint(4, 0)).toBe(cp("o"))
  expect(buffer.getCodePoint(5, 0)).toBe(32)
})

test("word wrap when content exceeds width", () => {
  const t = new Text()
  t.setBounds(0, 0, 10, 5)
  t.content = "Hello World Foo"

  const buffer = new ScreenBuffer(10, 5)
  t.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(cp("H"))
  expect(buffer.getCodePoint(0, 1)).toBe(cp("W"))
  expect(buffer.getCodePoint(6, 1)).toBe(cp("F"))
})

test("CJK character wraps correctly at boundary", () => {
  const t = new Text()
  t.setBounds(0, 0, 8, 5)
  t.content = "ABCD\u4e2dX"

  const buffer = new ScreenBuffer(8, 5)
  t.render(buffer)

  const cjk = cp("\u4e2d")
  // "ABCD" is 4 cells, then \u4e2d is 2 cells = 6, then "X" is 1 cell = 7 ≤ 8
  // All fits in one line
  expect(buffer.getCodePoint(4, 0)).toBe(cjk)
  expect(buffer.getCodePoint(6, 0)).toBe(cp("X"))
})

test("CJK word with width 2 wraps when at last column", () => {
  const t = new Text()
  t.setBounds(0, 0, 7, 5)
  t.content = "ABCDE\u4e2dX"

  const buffer = new ScreenBuffer(7, 5)
  t.render(buffer)

  const cjk = cp("\u4e2d")
  const cjkW = 2
  // "ABCDE" = 5 cells. Remaining = 7-5 = 2 cells. \u4e2d needs 2 cells = fits.
  // "X" = 1 cell, remaining = 0 → goes to line 1
  expect(buffer.getCodePoint(5, 0)).toBe(cjk)
  expect(buffer.getCodePoint(0, 1)).toBe(cp("X"))
})

test("empty content renders nothing", () => {
  const t = new Text()
  t.setBounds(0, 0, 10, 3)
  t.content = ""

  const buffer = new ScreenBuffer(10, 3)
  t.render(buffer)

  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 10; x++)
      expect(buffer.getCodePoint(x, y)).toBe(32)
})

test("setBounds width change triggers reflow", () => {
  const t = new Text()
  t.content = "Hello World"
  t.setBounds(0, 0, 5, 5)

  const buffer = new ScreenBuffer(5, 5)
  t.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(cp("H"))
  expect(buffer.getCodePoint(0, 2)).toBe(cp("W"))

  const wide = new ScreenBuffer(20, 5)
  t.setBounds(0, 0, 20, 5)
  t.dirty = true
  t.render(wide)

  expect(wide.getCodePoint(6, 0)).toBe(cp("W"))
})

test("content setter marks dirty", () => {
  const t = new Text()
  expect(t.dirty).toBe(true)

  t.content = "Hello"
  expect(t.dirty).toBe(true)

  t.dirty = false
  t.content = "Hello"
  expect(t.dirty).toBe(false)
})

test("long word that exceeds width is broken", () => {
  const t = new Text()
  t.setBounds(0, 0, 5, 5)
  t.content = "ABCDEFGHIJ"

  const buffer = new ScreenBuffer(5, 5)
  t.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(cp("A"))
  expect(buffer.getCodePoint(0, 1)).toBe(cp("F"))
})
