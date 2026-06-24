import { test, expect } from "bun:test"
import { SgrDelta } from "@/terminal/core/SgrDelta"

test("optimize removes redundant full SGR when state unchanged", () => {
  const d = new SgrDelta()
  const input = "\x1b[1;1H\x1b[0;38;5;15;48;5;4mHello\x1b[1;6H\x1b[0;38;5;15;48;5;4mWorld\x1b[0m"
  const out = d.optimize(input)
  expect(out).toBe("\x1b[1;1H\x1b[38;5;15;48;5;4mHello\x1b[1;6HWorld\x1b[0m")
})

test("optimize emits delta when only fg changes", () => {
  const d = new SgrDelta()
  d.resetState()
  const input = "\x1b[1;1H\x1b[0;38;5;15;48;5;4mHi\x1b[1;4H\x1b[0;38;5;2;48;5;4mLo\x1b[0m"
  const out = d.optimize(input)
  expect(out).toBe("\x1b[1;1H\x1b[38;5;15;48;5;4mHi\x1b[1;4H\x1b[38;5;2mLo\x1b[0m")
})

test("optimize emits delta when only bg changes", () => {
  const d = new SgrDelta()
  d.resetState()
  const input = "\x1b[1;1H\x1b[0;38;5;15;48;5;4mA\x1b[1;3H\x1b[0;38;5;15;48;5;2mB\x1b[0m"
  const out = d.optimize(input)
  expect(out).toBe("\x1b[1;1H\x1b[38;5;15;48;5;4mA\x1b[1;3H\x1b[48;5;2mB\x1b[0m")
})

test("optimize emits reset when terminal reset encountered between groups", () => {
  const d = new SgrDelta()
  d.resetState()
  const input = "\x1b[1;1H\x1b[0;38;5;2;48;5;4mX\x1b[0m\x1b[1;3H\x1b[0;38;5;2;48;5;4mY\x1b[0m"
  const out = d.optimize(input)
  expect(out).toBe("\x1b[1;1H\x1b[38;5;2;48;5;4mX\x1b[0m\x1b[1;3H\x1b[38;5;2;48;5;4mY\x1b[0m")
})

test("optimize removes trailing reset when defaults match", () => {
  const d = new SgrDelta()
  d.resetState()
  expect(d.optimize("\x1b[0m")).toBe("")
})

test("resetState clears tracked state so first SGR emits fully", () => {
  const d = new SgrDelta()
  d.optimize("\x1b[0;38;5;2;48;5;4mX\x1b[0m")
  d.resetState()
  const out = d.optimize("\x1b[0;38;5;2;48;5;4mY\x1b[0m")
  expect(out).toBe("\x1b[38;5;2;48;5;4mY\x1b[0m")
})

test("optimize with empty string returns empty", () => {
  const d = new SgrDelta()
  expect(d.optimize("")).toBe("")
})

test("optimize with no SGR sequences returns unchanged", () => {
  const d = new SgrDelta()
  expect(d.optimize("Hello World")).toBe("Hello World")
})

test("optimize with varying attributes emits delta for attribute changes only", () => {
  const d = new SgrDelta()
  d.resetState()
  const input = "\x1b[1;1H\x1b[0;38;5;15;48;5;4;1mBold\x1b[1;6H\x1b[0;38;5;15;48;5;4;3mItalic\x1b[0m"
  const out = d.optimize(input)
  expect(out).toBe("\x1b[1;1H\x1b[38;5;15;48;5;4;1mBold\x1b[1;6H\x1b[3mItalic\x1b[0m")
})

test("byte reduction benchmark — same color repeated", () => {
  const d = new SgrDelta()
  let input = ""
  for (let i = 0; i < 10; i++) {
    input += `\x1b[${i + 1};1H\x1b[0;38;5;15;48;5;4mX\x1b[0m`
  }
  const rawBytes = new TextEncoder().encode(input).length
  const out = d.optimize(input)
  const optimizedBytes = new TextEncoder().encode(out).length
  expect(optimizedBytes).toBeLessThan(rawBytes)
})
