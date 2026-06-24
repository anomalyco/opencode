import { test, expect } from "bun:test"
import { List } from "@/terminal/widgets/List"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import type { InputEvent } from "@/terminal/input/InputHandler"

const cp = (s: string, i = 0) => s.codePointAt(i)!

function key(k: string): InputEvent {
  return { type: "KEY", key: k }
}

test("renders items within viewport", () => {
  const list = new List()
  list.items = ["A", "B", "C"]
  list.setBounds(0, 0, 10, 5)
  const buf = new ScreenBuffer(10, 5)
  list.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(cp("A"))
  expect(buf.getCodePoint(0, 1)).toBe(cp("B"))
  expect(buf.getCodePoint(0, 2)).toBe(cp("C"))
})

test("selected item has reverse video", () => {
  const list = new List()
  list.items = ["X", "Y"]
  list.selectedIndex = 1
  list.setBounds(0, 0, 10, 5)
  const buf = new ScreenBuffer(10, 5)
  list.render(buf)
  expect(buf.getBg(0, 1)).toBe(15)
  expect(buf.getFg(0, 1)).toBe(0)
  expect(buf.getBg(0, 0)).toBe(0)
})

test("ArrowDown increases selection", () => {
  const list = new List()
  list.items = ["a", "b", "c"]
  list.onKey(key("ArrowDown"))
  expect(list.selectedIndex).toBe(1)
  list.onKey(key("ArrowDown"))
  expect(list.selectedIndex).toBe(2)
})

test("ArrowUp decreases selection", () => {
  const list = new List()
  list.items = ["a", "b", "c"]
  list.selectedIndex = 2
  list.onKey(key("ArrowUp"))
  expect(list.selectedIndex).toBe(1)
})

test("selectedIndex clamped at bounds", () => {
  const list = new List()
  list.items = ["a"]
  list.onKey(key("ArrowDown"))
  expect(list.selectedIndex).toBe(0)
  list.onKey(key("ArrowUp"))
  expect(list.selectedIndex).toBe(0)
})

test("scrollOffset follows selection", () => {
  const list = new List()
  list.items = Array.from({ length: 20 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 5)

  for (let i = 0; i < 10; i++) list.onKey(key("ArrowDown"))
  expect(list.selectedIndex).toBe(10)
  expect(list.scrollOffset).toBe(6)
})

test("virtualization: only h items rendered from 100k pool", () => {
  const list = new List()
  list.items = Array.from({ length: 100000 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 5)

  const buf = new ScreenBuffer(10, 5)
  list.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(cp("i"))
  expect(buf.getCodePoint(0, 4)).toBe(cp("i"))
})

test("onSelect fires on Enter", () => {
  const list = new List()
  list.items = ["hello", "world"]
  let idx = -1; let item = ""
  list.onSelect = (i, it) => { idx = i; item = it }
  list.onKey(key("Enter"))
  expect(idx).toBe(0)
  expect(item).toBe("hello")
})

test("Home and End navigation", () => {
  const list = new List()
  list.items = Array.from({ length: 100 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 5)
  list.onKey(key("End"))
  expect(list.selectedIndex).toBe(99)
  list.onKey(key("Home"))
  expect(list.selectedIndex).toBe(0)
})

test("PageDown moves by viewport height", () => {
  const list = new List()
  list.items = Array.from({ length: 100 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 10)
  list.onKey(key("PageDown"))
  expect(list.selectedIndex).toBe(10)
})

test("PageUp moves by viewport height", () => {
  const list = new List()
  list.items = Array.from({ length: 100 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 10)
  list.selectedIndex = 15
  list.onKey(key("PageUp"))
  expect(list.selectedIndex).toBe(5)
})
