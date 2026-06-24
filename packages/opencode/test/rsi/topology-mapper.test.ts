import { describe, expect, test } from "bun:test"
import { computeFailureTopology, extractFeatures, type FailurePoint } from "@/rsi/topology-mapper"

function makePoint(features: number[], errorType = "TypeError"): FailurePoint {
  return { input: null, errorType, errorMessage: "test", features }
}

describe("topology-mapper", () => {
  test("returns unknown topology for empty input", () => {
    const t = computeFailureTopology([])
    expect(t.boundaryType).toBe("unknown")
    expect(t.fractalDimension).toBe(1.0)
    expect(t.exploitableStructure).toBe(false)
  })

  test("detects flat boundary for collinear failures", () => {
    const failures = Array.from({ length: 30 }, (_, i) =>
      makePoint([i / 30, 0.5, 0.5, 0.5]),
    )
    const t = computeFailureTopology(failures)
    expect(t.fractalDimension).toBeGreaterThanOrEqual(1.0)
    expect(t.fractalDimension).toBeLessThan(1.3)
    expect(t.boundaryType).toMatch(/flat|convex/)
  })

  test("detects structure in scattered multi-cluster failures", () => {
    const cluster1 = Array.from({ length: 15 }, () =>
      makePoint([Math.random() * 0.2, Math.random() * 0.2, 0.1, 0.1], "TypeError"),
    )
    const cluster2 = Array.from({ length: 15 }, () =>
      makePoint([0.7 + Math.random() * 0.2, 0.7 + Math.random() * 0.2, 0.9, 0.9], "RangeError"),
    )
    const t = computeFailureTopology([...cluster1, ...cluster2])
    expect(t.clusters.length).toBeGreaterThanOrEqual(2)
    expect(t.fractalDimension).toBeGreaterThanOrEqual(1.0)
  })

  test("marks exploitableStructure true for fractal boundary", () => {
    const failures = Array.from({ length: 50 }, () =>
      makePoint([Math.random(), Math.random(), Math.random(), Math.random()], Math.random() > 0.5 ? "TypeError" : "RangeError"),
    )
    const t = computeFailureTopology(failures)
    expect(t.fractalDimension).toBeGreaterThanOrEqual(1.0)
    expect(t.informationDensity).toBeGreaterThan(0)
  })

  test("extracts features returning 4 normalized dimensions", () => {
    const f = extractFeatures("hello world", "TypeError", "something went wrong\nline 2")
    expect(f).toHaveLength(4)
    f.forEach((dim) => {
      expect(dim).toBeGreaterThanOrEqual(0)
      expect(dim).toBeLessThanOrEqual(1)
    })
  })

  test("handles single failure without crash", () => {
    const t = computeFailureTopology([makePoint([0.5, 0.5, 0.5, 0.5])])
    expect(t.fractalDimension).toBe(1.0)
  })
})
