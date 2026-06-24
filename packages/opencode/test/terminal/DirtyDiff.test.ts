import { describe, it, expect } from "bun:test"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import { computeDirtyDiff } from "@/terminal/core/DirtyDiff"
import { AttrMask } from "@/terminal/core/Cell"

describe("DirtyDiff", () => {
  it("returns empty string when buffers are identical", () => {
    const prev = new ScreenBuffer(80, 24)
    const curr = new ScreenBuffer(80, 24)
    expect(computeDirtyDiff(prev, curr)).toBe("")
  })

  it("outputs all cells when every cell differs", () => {
    const prev = new ScreenBuffer(5, 2)
    const curr = new ScreenBuffer(5, 2)

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 5; x++) {
        curr.setCell(x, y, 65 + x + y * 5, 0, 0, 0)
      }
    }

    const result = computeDirtyDiff(prev, curr)

    expect(result.length).toBeGreaterThan(0)
    expect(result.endsWith("\x1b[0m")).toBe(true)

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 5; x++) {
        const cp = 65 + x + y * 5
        expect(result).toContain(String.fromCodePoint(cp))
      }
    }
  })

  it("only outputs changed cells", () => {
    const prev = new ScreenBuffer(5, 1)
    const curr = new ScreenBuffer(5, 1)

    curr.setCell(2, 0, 65, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("[1;3H")
    expect(result).toContain(String.fromCodePoint(65))
  })

  it("skips continuation cells from wide characters", () => {
    const prev = new ScreenBuffer(5, 1)
    const curr = new ScreenBuffer(5, 1)

    curr.setCell(0, 0, 0x4E00, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("[1;1H")
    expect(result).toContain(String.fromCodePoint(0x4E00))
  })

  it("encodes default colors as 39/49", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("39")
    expect(result).toContain("49")
  })

  it("encodes 256-color palette codes", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 2, 3, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("38;5;2")
    expect(result).toContain("48;5;3")
  })

  it("encodes bold attribute", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, AttrMask.BOLD)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("[1;1H")
    expect(result).toContain(";1")
    expect(result).toContain(String.fromCodePoint(65))
  })

  it("encodes italic attribute", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, AttrMask.ITALIC)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain(";3")
  })

  it("encodes underline attribute", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, AttrMask.UNDERLINE)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain(";4")
  })

  it("encodes all attributes combined", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0,
      AttrMask.BOLD | AttrMask.ITALIC | AttrMask.UNDERLINE |
      AttrMask.STRIKE | AttrMask.INVERSE)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain(";1")
    expect(result).toContain(";3")
    expect(result).toContain(";4")
    expect(result).toContain(";9")
    expect(result).toContain(";7")
  })

  it("optimizes cursor movement with adjacent cells", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, 0)
    curr.setCell(1, 0, 66, 0, 0, 0)
    curr.setCell(2, 0, 67, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result).toContain("[1;1H")

    const cupCount = (result.match(/\x1b\[\d+;\d+H/g) || []).length
    expect(cupCount).toBe(1)
  })

  it("adds cursor jump for non-adjacent changed cells", () => {
    const prev = new ScreenBuffer(5, 1)
    const curr = new ScreenBuffer(5, 1)

    curr.setCell(0, 0, 65, 0, 0, 0)
    curr.setCell(4, 0, 66, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    const cupCount = (result.match(/\x1b\[\d+;\d+H/g) || []).length
    expect(cupCount).toBe(2)
  })

  it("ends with reset sequence", () => {
    const prev = new ScreenBuffer(3, 1)
    const curr = new ScreenBuffer(3, 1)

    curr.setCell(0, 0, 65, 0, 0, AttrMask.BOLD)

    const result = computeDirtyDiff(prev, curr)

    expect(result.endsWith("\x1b[0m")).toBe(true)
  })

  it("emits a continuation cell that was overwritten with a visible character", () => {
    const prev = new ScreenBuffer(5, 1)
    const curr = new ScreenBuffer(5, 1)

    prev.setCell(0, 0, 0x4E00, 0, 0, 0)
    curr.setCell(0, 0, 0x4E00, 0, 0, 0)
    curr.setCell(1, 0, 32, 0, 0, 0)

    const result = computeDirtyDiff(prev, curr)

    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("\x1b[1;2H")
  })
})
