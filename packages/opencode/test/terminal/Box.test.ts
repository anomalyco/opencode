import { test, expect } from "bun:test"
import { Box } from "@/terminal/widgets/Box"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import { Text } from "@/terminal/widgets/Text"

const cp = (s: string, i = 0) => s.codePointAt(i)!

test("box with border draws corners and edges", () => {
  const b = new Box()
  b.borderWidth = 1
  b.setBounds(0, 0, 10, 5)

  const buffer = new ScreenBuffer(10, 5)
  b.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(0x250c)
  expect(buffer.getCodePoint(9, 0)).toBe(0x2510)
  expect(buffer.getCodePoint(0, 4)).toBe(0x2514)
  expect(buffer.getCodePoint(9, 4)).toBe(0x2518)
  expect(buffer.getCodePoint(5, 0)).toBe(0x2500)
  expect(buffer.getCodePoint(0, 2)).toBe(0x2502)
})

test("box with title draws title in top border", () => {
  const b = new Box()
  b.borderWidth = 1
  b.title = "Hi"
  b.setBounds(0, 0, 10, 3)

  const buffer = new ScreenBuffer(10, 3)
  b.render(buffer)

  expect(buffer.getCodePoint(3, 0)).toBe(0x2500)
  expect(buffer.getCodePoint(4, 0)).toBe(cp("H"))
  expect(buffer.getCodePoint(5, 0)).toBe(cp("i"))
  expect(buffer.getCodePoint(6, 0)).toBe(0x2500)
})

test("box without border has no decorations", () => {
  const b = new Box()
  b.borderWidth = 0
  b.setBounds(0, 0, 5, 3)

  const buffer = new ScreenBuffer(5, 3)
  b.render(buffer)

  expect(buffer.getCodePoint(0, 0)).not.toBe(0x250c)
  expect(buffer.getCodePoint(0, 0)).toBe(32)
})

test("box renders children at computed positions", () => {
  const b = new Box()
  b.borderWidth = 0
  b.direction = "row"
  b.setBounds(0, 0, 20, 5)

  const left = Object.assign(new Text(), { grow: 1 })
  left.content = "A"
  const right = Object.assign(new Text(), { grow: 1 })
  right.content = "B"
  b.children = [left, right]

  const buffer = new ScreenBuffer(20, 5)
  b.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(cp("A"))
  expect(buffer.getCodePoint(10, 0)).toBe(cp("B"))
})

test("box with border renders children inside border area", () => {
  const b = new Box()
  b.borderWidth = 1
  b.direction = "row"
  b.setBounds(0, 0, 20, 6)

  const child = new Text()
  child.content = "X"
  b.children = [child]

  const buffer = new ScreenBuffer(20, 6)
  b.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(0x250c)
  expect(buffer.getCodePoint(1, 1)).toBe(cp("X"))
})
