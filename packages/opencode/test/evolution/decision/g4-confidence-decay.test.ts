import { describe, expect, test } from "bun:test"
import { effectiveConfidence } from "@/evolution/brain/memory"
import type { MemoryEntry } from "@/evolution/brain/memory"

const HALF_DAY_MS = 12 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function makeEntry(created: number, confidence?: number): MemoryEntry {
  return { id: "1", type: "lesson", content: "t", tags: [], created, updated: created, confidence }
}

describe("G4 — effectiveConfidence decay", () => {
  test("fresh entry (age=0) returns base confidence unchanged", () => {
    const e = makeEntry(0, 0.8)
    expect(effectiveConfidence(e, 0)).toBeCloseTo(0.8, 5)
  })

  test("default base is 0.5 when confidence undefined", () => {
    const e = makeEntry(0)
    expect(effectiveConfidence(e, 0)).toBeCloseTo(0.5, 5)
  })

  test("after one half-life, confidence halves", () => {
    const e = makeEntry(0, 1.0)
    expect(effectiveConfidence(e, THIRTY_DAYS_MS)).toBeCloseTo(0.5, 5)
  })

  test("after two half-lives, confidence quarters", () => {
    const e = makeEntry(0, 1.0)
    expect(effectiveConfidence(e, 2 * THIRTY_DAYS_MS)).toBeCloseTo(0.25, 5)
  })

  test("custom half-life", () => {
    const e = makeEntry(0, 1.0)
    expect(effectiveConfidence(e, HALF_DAY_MS, HALF_DAY_MS)).toBeCloseTo(0.5, 5)
  })

  test("confidence=0 stays 0", () => {
    const e = makeEntry(0, 0)
    expect(effectiveConfidence(e, 100 * THIRTY_DAYS_MS)).toBe(0)
  })

  test("very old entry decays toward zero", () => {
    const e = makeEntry(0, 1.0)
    const aged = effectiveConfidence(e, 10 * THIRTY_DAYS_MS)
    expect(aged).toBeGreaterThan(0)
    expect(aged).toBeLessThan(0.001)
  })

  test("created in future (negative age) raises confidence", () => {
    const e = makeEntry(100, 0.5)
    expect(effectiveConfidence(e, 0)).toBeGreaterThan(0.5)
  })
})
