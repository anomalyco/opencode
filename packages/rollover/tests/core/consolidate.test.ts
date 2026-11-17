import { describe, expect, test } from "bun:test"
import { validateConsolidation } from "../../src/core/consolidate"

describe("validateConsolidation", () => {
  const snapshot = new Set(["d1", "d2", "i3", "v4", "c5"])
  const corrections = new Set(["c5"])

  test("valid supersede", () => {
    const r = validateConsolidation({ invalidate: [{ id: "d1", reason: "superseded", by: "d2" }] }, snapshot, corrections)
    expect(r).toEqual({ invalidate: [{ kind: "invalidate", id: "d1", reason: "superseded", by: "d2", at: expect.any(Number) }] })
  })

  test("empty list valid", () => {
    const r = validateConsolidation({ invalidate: [] }, snapshot, corrections)
    expect(r).toEqual({ invalidate: [] })
  })

  test("unknown id → error", () => {
    const r = validateConsolidation({ invalidate: [{ id: "zz", reason: "superseded", by: "d2" }] }, snapshot, corrections)
    expect("error" in r).toBe(true)
  })

  test("unknown by → error", () => {
    const r = validateConsolidation({ invalidate: [{ id: "d1", reason: "superseded", by: "zz" }] }, snapshot, corrections)
    expect("error" in r).toBe(true)
  })

  test("user_correction invalidated only by another user_correction", () => {
    const r1 = validateConsolidation({ invalidate: [{ id: "c5", reason: "superseded", by: "d2" }] }, snapshot, corrections)
    expect("error" in r1).toBe(true)
    const r2 = validateConsolidation({ invalidate: [{ id: "c5", reason: "superseded", by: "c5" }] }, snapshot, corrections)
    // by must be a different id that is itself a user_correction; c5→c5 is same record, reject
    expect("error" in r2).toBe(true)
  })

  test("correction invalidated by another correction is valid", () => {
    const snap = new Set(["c1", "c2"])
    const corr = new Set(["c1", "c2"])
    const r = validateConsolidation({ invalidate: [{ id: "c1", reason: "superseded", by: "c2" }] }, snap, corr)
    expect("error" in r).toBe(false)
  })

  test("resolved open_item valid", () => {
    const r = validateConsolidation({ invalidate: [{ id: "i3", reason: "resolved", by: "v4" }] }, snapshot, corrections)
    expect("error" in r).toBe(false)
  })

  test("duplicate reason valid", () => {
    const r = validateConsolidation({ invalidate: [{ id: "d1", reason: "duplicate", by: "d2" }] }, snapshot, corrections)
    expect("error" in r).toBe(false)
  })

  test("invalid reason → error", () => {
    const r = validateConsolidation({ invalidate: [{ id: "d1", reason: "bogus", by: "d2" }] }, snapshot, corrections)
    expect("error" in r).toBe(true)
  })

  test("malformed input → error", () => {
    const r = validateConsolidation("not json", snapshot, corrections)
    expect("error" in r).toBe(true)
  })
})
