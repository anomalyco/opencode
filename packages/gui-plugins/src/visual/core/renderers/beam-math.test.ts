/* oxlint-disable anti-slop/no-shape-in-symbol-names -- the test mirrors the documented JSON key "shape". */
import { describe, expect, test } from "bun:test"
import type { VisualSpec } from "../spec"
import { readBeam, solve } from "./beam-math"

const spec: VisualSpec = {
  v: 1,
  kind: "beam",
  title: "Pin beam",
  unit: "m, kN, mm",
  data: {
    type: "simply-supported",
    length: 4,
    loads: [
      { type: "udl", from: 0, to: 4, magnitude: 8 },
      { type: "point", x: 3, magnitude: 12 },
    ],
    section: { shape: "rect", b: 100, h: 200 },
    E: 200,
    yield: 250,
  },
}

describe("beam solver", () => {
  const result = solve(readBeam(spec))

  test("balances the reactions", () => {
    expect(result.leftReaction).toBeCloseTo(19, 6)
    expect(result.rightReaction).toBeCloseTo(25, 6)
    expect(result.leftReaction + result.rightReaction).toBeCloseTo(44, 6)
  })

  test("peaks just before the point load", () => {
    expect(result.peakMoment).toBeCloseTo(22.5625, 3)
    const at = result.x[result.moment.indexOf(result.peakMoment)]
    expect(at).toBeGreaterThan(2.3)
    expect(at).toBeLessThan(2.5)
  })

  test("reports the section stress", () => {
    expect(result.stress).toBeCloseTo(33.84, 1)
    expect(result.props?.inertia).toBeCloseTo(6.6667e-5, 9)
  })

  test("deflects in the expected range", () => {
    expect(result.maxDeflection).toBeCloseTo(2.83, 1)
  })

  test("ends the moment diagram at zero", () => {
    expect(result.moment[result.moment.length - 1]).toBeCloseTo(0, 1)
  })
})
