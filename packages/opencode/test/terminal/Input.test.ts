import { test, expect } from "bun:test"
import { Input } from "@/terminal/widgets/Input"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import type { InputEvent } from "@/terminal/input/InputHandler"

const cp = (s: string, i = 0) => s.codePointAt(i)!

function key(k: string): InputEvent {
  return { type: "KEY", key: k }
}

function char(c: string): InputEvent {
  return { type: "CHAR", char: c }
}

test("insert character at cursor", () => {
  const input = new Input()
  input.setBounds(0, 0, 20, 3)
  input.onKey(char("H"))
  input.onKey(char("i"))
  expect(input.value).toBe("Hi")
  expect(input.cursorPos).toBe(2)
})

test("backspace removes character before cursor", () => {
  const input = new Input()
  input.value = "Hi"
  input.cursorPos = 2
  input.onKey(key("Backspace"))
  expect(input.value).toBe("H")
  expect(input.cursorPos).toBe(1)
})

test("delete removes character at cursor", () => {
  const input = new Input()
  input.value = "Hi"
  input.cursorPos = 0
  input.onKey(key("Delete"))
  expect(input.value).toBe("i")
})

test("arrow left and right move cursor", () => {
  const input = new Input()
  input.value = "ABC"
  input.cursorPos = 3
  input.onKey(key("ArrowLeft"))
  expect(input.cursorPos).toBe(2)
  input.onKey(key("ArrowLeft"))
  expect(input.cursorPos).toBe(1)
  input.onKey(key("ArrowRight"))
  expect(input.cursorPos).toBe(2)
})

test("home moves to start, end moves to end", () => {
  const input = new Input()
  input.value = "Hello"
  input.cursorPos = 3
  input.onKey(key("Home"))
  expect(input.cursorPos).toBe(0)
  input.onKey(key("End"))
  expect(input.cursorPos).toBe(5)
})

test("onConfirm fires with current value on Enter", () => {
  const input = new Input()
  input.value = "submitted"
  let confirmed = ""
  input.onConfirm = (v) => { confirmed = v }
  input.onKey(key("Enter"))
  expect(confirmed).toBe("submitted")
})

test("render shows content", () => {
  const input = new Input()
  input.value = "Hi"
  input.setBounds(0, 0, 10, 3)
  const buf = new ScreenBuffer(10, 3)
  input.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(cp("H"))
  expect(buf.getCodePoint(1, 0)).toBe(cp("i"))
})

test("cursor renders at cursorPos when visible", () => {
  const input = new Input()
  input.value = "AB"
  input.cursorPos = 1
  input.cursorVisible = true
  input.setBounds(0, 0, 10, 3)
  const buf = new ScreenBuffer(10, 3)
  input.render(buf)
  expect(buf.getBg(1, 0)).toBe(15)
  expect(buf.getFg(1, 0)).toBe(0)
})

test("onFocus shows cursor, onBlur hides it", () => {
  const input = new Input()
  expect(input.cursorVisible).toBe(false)
  input.onFocus()
  expect(input.cursorVisible).toBe(true)
  input.onBlur()
  expect(input.cursorVisible).toBe(false)
})
