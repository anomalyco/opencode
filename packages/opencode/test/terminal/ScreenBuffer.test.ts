import { describe, it, expect } from "bun:test"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import { AttrMask, encodeAttrs } from "@/terminal/core/Cell"

describe("ScreenBuffer", () => {
  it("creates buffer with given dimensions", () => {
    const buf = new ScreenBuffer(80, 24)
    expect(buf.width).toBe(80)
    expect(buf.height).toBe(24)
  })

  it("throws on invalid dimensions", () => {
    expect(() => new ScreenBuffer(0, 24)).toThrow(RangeError)
    expect(() => new ScreenBuffer(80, 0)).toThrow(RangeError)
    expect(() => new ScreenBuffer(-1, 24)).toThrow(RangeError)
  })

  it("initializes with spaces and defaults", () => {
    const buf = new ScreenBuffer(80, 24)
    expect(buf.getCodePoint(0, 0)).toBe(32)
    expect(buf.getFg(0, 0)).toBe(0)
    expect(buf.getBg(0, 0)).toBe(0)
    expect(buf.getAttr(0, 0)).toBe(0)
    expect(buf.getCellWidth(0, 0)).toBe(1)
  })

  it("setCell and getCodePoint round-trip", () => {
    const buf = new ScreenBuffer(80, 24)
    buf.setCell(10, 5, 65, 2, 3, AttrMask.BOLD)
    expect(buf.getCodePoint(10, 5)).toBe(65)
    expect(buf.getFg(10, 5)).toBe(2)
    expect(buf.getBg(10, 5)).toBe(3)
    expect(buf.getAttr(10, 5)).toBe(AttrMask.BOLD)
  })

  it("throws on out-of-bounds access", () => {
    const buf = new ScreenBuffer(80, 24)
    expect(() => buf.getCodePoint(-1, 0)).toThrow(RangeError)
    expect(() => buf.getCodePoint(80, 0)).toThrow(RangeError)
    expect(() => buf.getCodePoint(0, 24)).toThrow(RangeError)
    expect(() => buf.getCodePoint(0, -1)).toThrow(RangeError)
    expect(() => buf.setCell(80, 0, 65, 0, 0, 0)).toThrow(RangeError)
  })

  it("clear resets all cells", () => {
    const buf = new ScreenBuffer(80, 24)
    buf.setCell(0, 0, 65, 2, 3, AttrMask.BOLD)
    buf.setCell(79, 23, 66, 4, 5, AttrMask.ITALIC)
    buf.clear()
    expect(buf.getCodePoint(0, 0)).toBe(32)
    expect(buf.getFg(0, 0)).toBe(0)
    expect(buf.getBg(0, 0)).toBe(0)
    expect(buf.getAttr(0, 0)).toBe(0)
    expect(buf.getCodePoint(79, 23)).toBe(32)
  })

  it("handles wide characters (CJK)", () => {
    const buf = new ScreenBuffer(80, 24)
    const cjkCp = 0x4E00
    buf.setCell(5, 0, cjkCp, 0, 0, 0)
    expect(buf.getCodePoint(5, 0)).toBe(cjkCp)
    expect(buf.getCellWidth(5, 0)).toBe(2)
    expect(buf.getCellWidth(6, 0)).toBe(0)
    expect(buf.getCodePoint(6, 0)).toBe(32)
  })

  it("does not overflow continuation past buffer edge", () => {
    const buf = new ScreenBuffer(80, 24)
    buf.setCell(79, 0, 0x4E00, 0, 0, 0)
    expect(buf.getCellWidth(79, 0)).toBe(2)
  })

  it("cellEquals detects equal cells", () => {
    const a = new ScreenBuffer(80, 24)
    const b = new ScreenBuffer(80, 24)
    a.setCell(0, 0, 65, 1, 2, AttrMask.BOLD)
    b.setCell(0, 0, 65, 1, 2, AttrMask.BOLD)
    expect(a.cellEquals(0, 0, b, 0, 0)).toBe(true)
  })

  it("cellEquals detects different cells", () => {
    const a = new ScreenBuffer(80, 24)
    const b = new ScreenBuffer(80, 24)
    a.setCell(0, 0, 65, 1, 2, 0)
    b.setCell(0, 0, 66, 1, 2, 0)
    expect(a.cellEquals(0, 0, b, 0, 0)).toBe(false)
  })

  it("clone creates independent copy", () => {
    const a = new ScreenBuffer(80, 24)
    a.setCell(10, 5, 65, 2, 3, AttrMask.BOLD)
    const b = a.clone()
    expect(b.getCodePoint(10, 5)).toBe(65)
    a.setCell(10, 5, 66, 0, 0, 0)
    expect(b.getCodePoint(10, 5)).toBe(65)
  })

  it("copyFrom copies content", () => {
    const a = new ScreenBuffer(80, 24)
    const b = new ScreenBuffer(80, 24)
    a.setCell(10, 5, 65, 2, 3, AttrMask.BOLD)
    b.copyFrom(a)
    expect(b.getCodePoint(10, 5)).toBe(65)
    expect(b.getFg(10, 5)).toBe(2)
  })

  it("copyFrom throws on dimension mismatch", () => {
    const a = new ScreenBuffer(80, 24)
    const b = new ScreenBuffer(40, 12)
    expect(() => b.copyFrom(a)).toThrow("Dimension mismatch")
  })

  it("setCell with CJK near right edge clears continuation width flag", () => {
    const buf = new ScreenBuffer(80, 24)
    const cp = 0x4E00
    buf.setCell(79, 0, cp, 0, 0, 0)
    expect(buf.getCellWidth(79, 0)).toBe(2)
  })

  it("multiple wide chars in same row", () => {
    const buf = new ScreenBuffer(80, 24)
    buf.setCell(0, 0, 0x4E00, 0, 0, 0)
    buf.setCell(2, 0, 0x4E01, 0, 0, 0)
    expect(buf.getCellWidth(0, 0)).toBe(2)
    expect(buf.getCodePoint(0, 0)).toBe(0x4E00)
    expect(buf.getCellWidth(1, 0)).toBe(0)
    expect(buf.getCellWidth(2, 0)).toBe(2)
    expect(buf.getCodePoint(2, 0)).toBe(0x4E01)
  })
})
