import { expect, test } from "bun:test"
import { stripAnsi } from "./ansi"

test("strips colors, cursor moves and erase sequences", () => {
  expect(stripAnsi("\u001B[31mred\u001B[0m \u001B[1;32;40mbold\u001B[m")).toBe("red bold")
  expect(stripAnsi("a\u001B[2K\u001B[1Gb\u001B[10;20Hc")).toBe("abc")
  expect(stripAnsi("\u001B[38:2:255:0:0mtruecolor\u001B[0m")).toBe("truecolor")
  expect(stripAnsi("\u009B31mc1\u009B0m")).toBe("c1")
})

test("strips OSC sequences with every terminator", () => {
  expect(stripAnsi("\u001B]0;title\u0007text")).toBe("text")
  expect(stripAnsi("\u001B]8;;https://example.com\u001B\\link\u001B]8;;\u001B\\")).toBe("link")
  expect(stripAnsi("\u001B]0;title\u009Ctext")).toBe("text")
})

test("leaves plain text, newlines and unrelated escapes alone", () => {
  expect(stripAnsi("plain\r\ntext\ttab")).toBe("plain\r\ntext\ttab")
  expect(stripAnsi("")).toBe("")
  expect(stripAnsi("[31mnot an escape")).toBe("[31mnot an escape")
})

test("an unterminated OSC does not swallow the rest of the input", () => {
  expect(stripAnsi("\u001B]0;title\nkept")).toBe("itle\nkept")
})

test("is stateless across calls", () => {
  expect(stripAnsi("\u001B[1ma")).toBe("a")
  expect(stripAnsi("\u001B[1ma")).toBe("a")
})
