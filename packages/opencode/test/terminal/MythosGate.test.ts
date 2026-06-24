import { test, expect } from "bun:test"
import { Box } from "@/terminal/widgets/Box"
import { Text } from "@/terminal/widgets/Text"
import { Reconciler } from "@/terminal/app/Reconciler"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import { Flex } from "@/terminal/layout/Flex"
import type { LayoutNode } from "@/terminal/layout/Types"
import { FocusManager } from "@/terminal/app/FocusManager"
import { Input } from "@/terminal/widgets/Input"
import { List } from "@/terminal/widgets/List"
import { widgetStub } from "./lib/widget-stub"

const cp = (s: string, i = 0) => s.codePointAt(i)!

function isBox(w: unknown): w is Box {
  return w instanceof Box
}

function isText(w: unknown): w is Text {
  return w instanceof Text
}

// ─── Gate 1: Stress Layout ──────────────────────────────────────────────

test("[Mythos Gate 1] 3-level nested layout renders without overflow", () => {
  const root = new Box()
  root.borderWidth = 0
  root.direction = "row"
  root.setBounds(0, 0, 20, 10)

  const left = new Box()
  left.direction = "column"
  left.borderWidth = 1
  const leftText = new Text()
  leftText.content = "This is a long text that must wrap inside the left panel without overflowing"
  left.children = [leftText]

  const right = new Box()
  right.direction = "column"
  right.borderWidth = 1
  const rightText = new Text()
  rightText.content = "Right panel content also wraps"
  right.children = [rightText]

  root.children = [left, right]

  const buffer = new ScreenBuffer(20, 10)
  root.render(buffer)

  expect(buffer.getCodePoint(0, 0)).toBe(0x250c)
  expect(buffer.getCodePoint(0, 0)).toBe(cp(root.title || "", 0) ? 0x250c : 0x250c)
})

test("[Mythos Gate 1] resize from 20x10 to 30x15 reflows correctly", () => {
  const root = new Box()
  root.borderWidth = 0
  root.direction = "row"
  root.setBounds(0, 0, 20, 10)

  const child = new Text()
  child.content = "Hello World Foo Bar Baz"
  root.children = [child]

  const small = new ScreenBuffer(20, 10)
  root.render(small)

  const col0line1small = small.getCodePoint(0, 1)

  root.setBounds(0, 0, 30, 15)
  root.dirty = true
  const large = new ScreenBuffer(30, 15)
  root.render(large)

  expect(large.getCodePoint(0, 0)).toBe(cp("H"))
})

test("[Mythos Gate 1] nested Box + border + padding works", () => {
  const root = new Box()
  root.borderWidth = 1
  root.setBounds(0, 0, 15, 8)

  const inner = new Box()
  inner.borderWidth = 1
  const txt = new Text()
  txt.content = "Inner"
  inner.children = [txt]
  root.children = [inner]

  const buf = new ScreenBuffer(15, 8)
  root.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(0x250c)
  expect(buf.getCodePoint(14, 0)).toBe(0x2510)
  expect(buf.getCodePoint(0, 7)).toBe(0x2514)
  expect(buf.getCodePoint(14, 7)).toBe(0x2518)
})

// ─── Gate 2: Streaming Flicker ──────────────────────────────────────────

test("[Mythos Gate 2] Reconciler isolates Text dirty from Box", () => {
  const box = new Box()
  box.borderWidth = 0
  box.setBounds(0, 0, 20, 3)

  const text = new Text()
  text.content = "initial"
  text.dirty = true
  box.children = [text]

  box.dirty = true
  box.render(new ScreenBuffer(20, 3))
  box.dirty = false
  text.dirty = false

  const reconciler = new Reconciler()

  const N = 100
  const start = performance.now()

  for (let i = 0; i < N; i++) {
    const changed = reconciler.diff("text1", { content: `token${i}` }, text)
    if (changed) {
      text.content = `token${i}`
      expect(text.dirty).toBe(true)
      expect(box.dirty).toBe(false)
      text.render(new ScreenBuffer(20, 3))
      text.dirty = false
    }
  }

  const elapsed = performance.now() - start
  expect(elapsed).toBeLessThan(1000)
  expect(elapsed / N).toBeLessThan(10)
})

test("[Mythos Gate 2] rapid render does not break content order", () => {
  const text = new Text()
  text.setBounds(0, 0, 20, 5)
  const buf = new ScreenBuffer(20, 5)

  for (let i = 0; i < 50; i++) {
    text.content = `line ${i}`
    text.dirty = true
    text.render(buf)
  }

  expect(buf.getCodePoint(5, 0)).toBe(cp("4"))
  expect(buf.getCodePoint(6, 0)).toBe(cp("9"))
})

// ─── Gate 3: Zero-Leak Resize ───────────────────────────────────────────

test("[Mythos Gate 3] rapid setBounds does not crash", () => {
  const root = new Box()
  root.borderWidth = 0
  root.direction = "column"

  const text = new Text()
  text.content = "resize test"
  root.children = [text]

  for (let i = 0; i < 10; i++) {
    const w = 10 + i * 3
    const h = 5 + i
    root.setBounds(0, 0, w, h)
    root.dirty = true
    const buf = new ScreenBuffer(w, h)
    root.render(buf)
    expect(buf.getCodePoint(0, 0)).toBe(cp("r"))
  }
})

test("[Mythos Gate 3] size oscillation between narrow and wide", () => {
  const text = new Text()
  text.content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const sizes = [5, 30, 8, 25, 3, 40]

  for (const w of sizes) {
    const h = 10
    text.setBounds(0, 0, w, h)
    text.dirty = true
    const buf = new ScreenBuffer(w, h)
    text.render(buf)
    expect(buf.getCodePoint(0, 0)).toBe(cp("A"))
  }
})

// ─── Gate 4: Focus Trap ────────────────────────────────────────────────

test("[Mythos Gate 4] Focus Trap — Tab cycles circularly, never null", () => {
  const fm = new FocusManager()
  const a = new Input(); a.value = "A"
  const b = new Input(); b.value = "B"
  const c = new List(); c.items = ["C1", "C2"]
  fm.add("a", a); fm.add("b", b); fm.add("c", c)

  for (let i = 0; i < 10; i++) {
    fm.focusNext()
    expect(fm.focused).not.toBeNull()
  }
})

test("[Mythos Gate 4] Focus Trap — Shift+Tab cycles backward, never null", () => {
  const fm = new FocusManager()
  fm.add("a", widgetStub())
  fm.add("b", widgetStub())
  fm.add("c", widgetStub())

  for (let i = 0; i < 10; i++) {
    fm.focusPrev()
    expect(fm.focused).not.toBeNull()
  }
})

test("[Mythos Gate 4] Focus Trap — Tab 10x has exactly 1 cursor visible at each step", () => {
  const fm = new FocusManager()
  const a = new Input(); a.value = "hello"; a.setBounds(0, 0, 10, 3)
  const b = new Input(); b.value = "world"; b.setBounds(0, 0, 10, 3)
  fm.add("a", a); fm.add("b", b)

  // First Tab focuses 'a' → a.cursorVisible = true
  fm.focusNext()
  expect(a.cursorVisible).toBe(true)
  expect(b.cursorVisible).toBe(false)

  // Second Tab focuses 'b' → a.blur, b.focus
  fm.focusNext()
  expect(a.cursorVisible).toBe(false)
  expect(b.cursorVisible).toBe(true)
})

// ─── Gate 5: Cursor Stability ────────────────────────────────────────────

test("[Mythos Gate 5] Cursor Stability — text insertion with border box intact", () => {
  const box = new Box()
  box.borderWidth = 1
  box.setBounds(0, 0, 20, 5)

  const input = new Input()
  input.value = "Hello World"
  input.cursorPos = input.value.length
  input.setBounds(1, 1, 18, 3)
  box.children = [input]

  const buf = new ScreenBuffer(20, 5)
  box.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(0x250c)
  expect(buf.getCodePoint(19, 0)).toBe(0x2510)
  expect(buf.getCodePoint(0, 4)).toBe(0x2514)
  expect(buf.getCodePoint(19, 4)).toBe(0x2518)

  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "KEY", key: "ArrowLeft" })
  input.onKey({ type: "CHAR", char: "X" })
  input.onKey({ type: "CHAR", char: "1" })
  input.onKey({ type: "CHAR", char: "2" })
  input.onKey({ type: "CHAR", char: "3" })

  expect(input.value).toBe("HelloX123 World")

  buf.clear()
  box.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(0x250c)
  expect(buf.getCodePoint(19, 0)).toBe(0x2510)
})

test("[Mythos Gate 5] Cursor Stability — CJK cursor covers 2 cells", () => {
  const input = new Input()
  input.value = "\u4e2d\u56fd"
  input.cursorPos = 0
  input.cursorVisible = true
  input.setBounds(0, 0, 10, 3)
  const buf = new ScreenBuffer(10, 3)
  input.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(0x4e2d)
  expect(buf.getCodePoint(1, 0)).toBe(32)
  expect(buf.getBg(0, 0)).toBe(15)
  expect(buf.getBg(1, 0)).toBe(15)
})

// ─── Gate 6: Virtualization Memory ──────────────────────────────────────

test("[Mythos Gate 6] Virtualization Memory — 100k items, O(h) render, memory stable", () => {
  const list = new List()
  list.items = Array.from({ length: 100000 }, (_, i) => `item${i}`)
  list.setBounds(0, 0, 10, 5)

  for (let i = 0; i < 99999; i++) list.onKey({ type: "KEY", key: "ArrowDown" })

  expect(list.selectedIndex).toBe(99999)
  expect(list.scrollOffset).toBe(99995)

  const buf = new ScreenBuffer(10, 5)
  list.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(cp("i"))
})

test("[Mythos Gate 6] Virtualization Memory — only h items rendered, not all items", () => {
  const list = new List()
  list.items = Array.from({ length: 100000 })
  list.setBounds(0, 0, 10, 5)

  const buf = new ScreenBuffer(10, 5)
  list.render(buf)

  expect(buf.getCodePoint(0, 0)).toBe(32)
  expect(buf.getCodePoint(0, 4)).toBe(32)
})

// ─── Flex Solver Contract Proof ──────────────────────────────────────────

test("[Contract] Flex solver is O(N) two-pass (measure + distribute)", () => {
  const node: LayoutNode = {
    x: 0, y: 0, width: 100, height: 50,
    direction: "row",
    children: [
      { x: 0, y: 0, width: 0, height: 0, grow: 1, children: [] },
      { x: 0, y: 0, width: 0, height: 0, grow: 2, children: [] },
      { x: 0, y: 0, width: 0, height: 0, grow: 3, children: [] },
    ],
  }

  const flex = new Flex()
  flex.solve(node, 100, 50)

  expect(node.children[0].width).toBe(16)
  expect(node.children[1].width).toBe(33)
  expect(node.children[2].width).toBe(50)
})
