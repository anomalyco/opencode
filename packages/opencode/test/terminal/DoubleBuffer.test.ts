import { describe, it, expect } from "bun:test"
import { DoubleBuffer } from "@/terminal/buffer/DoubleBuffer"

describe("DoubleBuffer", () => {
  it("creates two buffers with given dimensions", () => {
    const db = new DoubleBuffer(80, 24)
    expect(db.width).toBe(80)
    expect(db.height).toBe(24)
  })

  it("getBack returns a writable buffer", () => {
    const db = new DoubleBuffer(5, 1)
    const back = db.getBack()
    back.setCell(2, 0, 65, 0, 0, 0)
    expect(back.getCodePoint(2, 0)).toBe(65)
  })

  it("swap returns empty string when no changes", () => {
    const db = new DoubleBuffer(5, 1)
    const diff = db.swap()
    expect(diff).toBe("")
  })

  it("swap returns diff and swaps buffers", () => {
    const db = new DoubleBuffer(5, 1)
    const back = db.getBack()
    back.setCell(2, 0, 65, 0, 0, 0)

    const diff = db.swap()
    expect(diff.length).toBeGreaterThan(0)
    expect(diff).toContain(String.fromCodePoint(65))

    const backAfter = db.getBack()
    backAfter.setCell(2, 0, 32, 0, 0, 0)

    const diff2 = db.swap()
    expect(diff2).toContain("[1;3H")
  })

  it("returns fresh back buffer after swap", () => {
    const db = new DoubleBuffer(5, 1)
    const back = db.getBack()
    back.setCell(0, 0, 65, 0, 0, 0)

    db.swap()

    const newBack = db.getBack()
    expect(newBack.getCodePoint(0, 0)).toBe(32)
  })

  it("resize reinitializes buffers", () => {
    const db = new DoubleBuffer(5, 1)
    expect(db.width).toBe(5)
    expect(db.height).toBe(1)

    db.resize(80, 24)
    expect(db.width).toBe(80)
    expect(db.height).toBe(24)

    const diff = db.swap()
    expect(diff).toBe("")
  })
})
