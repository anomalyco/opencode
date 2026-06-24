import { test, expect } from "bun:test"
import { ProgressBar } from "@/terminal/widgets/ProgressBar"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"

test("determinate 0% render", () => {
  const pb = new ProgressBar()
  pb.value = 0
  pb.setBounds(0, 0, 12, 1)
  const buf = new ScreenBuffer(12, 1)
  pb.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(0x005b)
  expect(buf.getCodePoint(11, 0)).toBe(0x005d)
})

test("determinate 50% shows percentage text at center", () => {
  const pb = new ProgressBar()
  pb.value = 50
  pb.setBounds(0, 0, 12, 1)
  const buf = new ScreenBuffer(12, 1)
  pb.render(buf)
  expect(buf.getCodePoint(0, 0)).toBe(0x005b)
  expect(buf.getCodePoint(11, 0)).toBe(0x005d)
  expect(buf.getCodePoint(4, 0)).toBe(0x0035)
  expect(buf.getCodePoint(5, 0)).toBe(0x0030)
  expect(buf.getCodePoint(6, 0)).toBe(0x0025)
})

test("determinate 100% all filled", () => {
  const pb = new ProgressBar()
  pb.value = 100
  pb.setBounds(0, 0, 12, 1)
  const buf = new ScreenBuffer(12, 1)
  pb.render(buf)
  expect(buf.getCodePoint(1, 0)).toBe(0x2588)
  expect(buf.getCodePoint(4, 0)).toBe(0x0031)
})

test("indeterminate toggles phase on tick", () => {
  const pb = new ProgressBar()
  pb.indeterminate = true
  pb.setBounds(0, 0, 12, 1)
  const before = pb.dirty
  pb.onTick()
  expect(pb.dirty).toBe(true)
})

test("setBounds marks dirty", () => {
  const pb = new ProgressBar()
  pb.dirty = false
  pb.setBounds(0, 0, 5, 1)
  expect(pb.dirty).toBe(true)
})
