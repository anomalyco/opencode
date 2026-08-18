import { describe, expect, test } from "bun:test"
import { TurnBudget } from "@/session/turn-budget"
import { headroom, recordHeadroom } from "@/session/overflow"

describe("turn budget bookkeeping", () => {
  test("records and consumes a stop reason once", () => {
    TurnBudget.record("s1", { reason: "turn_tokens", steps: 12, tokens: 900_000, seconds: 400 })

    const first = TurnBudget.consume("s1")
    expect(first?.reason).toBe("turn_tokens")
    expect(first?.steps).toBe(12)

    // A session that later completes normally must not inherit the verdict.
    expect(TurnBudget.consume("s1")).toBeUndefined()
  })

  test("consume is per-session", () => {
    TurnBudget.record("s2", { reason: "max_steps", steps: 20, tokens: 1, seconds: 1 })
    expect(TurnBudget.consume("s3")).toBeUndefined()
    expect(TurnBudget.consume("s2")?.reason).toBe("max_steps")
  })

  test("clear drops a pending entry", () => {
    TurnBudget.record("s4", { reason: "turn_seconds", steps: 3, tokens: 5, seconds: 600 })
    TurnBudget.clear("s4")
    expect(TurnBudget.consume("s4")).toBeUndefined()
  })
})

describe("headroom snapshot", () => {
  test("reports remaining headroom for the last prepared request", () => {
    recordHeadroom("h1", { usable: 48_128, estimated: 20_000 })
    expect(headroom("h1")).toEqual({ usable: 48_128, estimated: 20_000, headroom: 28_128 })
  })

  test("a turn already over budget reports zero, never a deficit", () => {
    recordHeadroom("h2", { usable: 10_000, estimated: 12_000 })
    expect(headroom("h2")?.headroom).toBe(0)
  })

  test("a model with no usable window records nothing rather than a wrong zero", () => {
    recordHeadroom("h3", { usable: 0, estimated: 5_000 })
    expect(headroom("h3")).toBeUndefined()
  })

  test("later requests replace the snapshot", () => {
    recordHeadroom("h4", { usable: 50_000, estimated: 1_000 })
    recordHeadroom("h4", { usable: 50_000, estimated: 40_000 })
    expect(headroom("h4")?.headroom).toBe(10_000)
  })
})
