import { describe, expect, test } from "bun:test"
import { createColors, createFrames } from "../../src/ui/spinner"

const ACTIVE = "■"
const INACTIVE = "·"

describe("createFrames blocks style", () => {
  const frames = createFrames({ color: "#4682dc", style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 })

  test("only uses glyphs that are present in common terminal fonts", () => {
    const glyphs = new Set(frames.flatMap((frame) => [...frame]))
    expect(glyphs).toEqual(new Set([ACTIVE, INACTIVE]))
    expect(glyphs.has("\u2b1d")).toBe(false)
  })

  test("keeps every frame eight cells wide", () => {
    expect(frames).toHaveLength(54)
    for (const frame of frames) expect([...frame]).toHaveLength(8)
  })

  test("starts at the left edge", () => {
    expect(frames[0]).toBe(ACTIVE + INACTIVE.repeat(7))
  })

  test("moves the head and trail to the right", () => {
    expect(frames[1]).toBe(ACTIVE.repeat(2) + INACTIVE.repeat(6))
    expect(frames[5]).toBe(ACTIVE.repeat(6) + INACTIVE.repeat(2))
  })

  test("provides a per-cell color generator", () => {
    const color = createColors({ color: "#4682dc", style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 })
    expect(typeof color).toBe("function")
  })
})
