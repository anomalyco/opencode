import { describe, expect, test } from "bun:test"
import { dominates, paretoFront, selectBest, type ParetoPoint } from "../src/pareto.ts"

const p = (id: string, score: number, passRate: number, sizeBytes: number): ParetoPoint => ({
  id,
  score,
  passRate,
  sizeBytes,
})

describe("pareto", () => {
  test("dominates: better score, smaller size, same pass", () => {
    expect(dominates(p("a", 0.9, 0.5, 100), p("b", 0.8, 0.5, 120))).toBe(true)
    expect(dominates(p("b", 0.8, 0.5, 120), p("a", 0.9, 0.5, 100))).toBe(false)
  })

  test("no domination on a trade-off (higher score but bigger)", () => {
    expect(dominates(p("a", 0.9, 0.5, 200), p("b", 0.8, 0.5, 100))).toBe(false)
    expect(dominates(p("b", 0.8, 0.5, 100), p("a", 0.9, 0.5, 200))).toBe(false)
  })

  test("equal points do not dominate each other", () => {
    expect(dominates(p("a", 0.8, 0.5, 100), p("b", 0.8, 0.5, 100))).toBe(false)
  })

  test("paretoFront keeps only non-dominated points", () => {
    const points = [
      p("dominated", 0.5, 0.5, 300),
      p("small-good", 0.9, 0.8, 100),
      p("tradeoff", 0.95, 0.8, 250),
    ]
    const front = paretoFront(points).map((x) => x.id).sort()
    expect(front).toEqual(["small-good", "tradeoff"])
  })

  test("selectBest prefers score, then pass rate, then smaller size", () => {
    const best = selectBest([p("a", 0.9, 0.5, 100), p("b", 0.9, 0.9, 200), p("c", 0.8, 1, 50)])
    expect(best?.id).toBe("b")
  })
})
