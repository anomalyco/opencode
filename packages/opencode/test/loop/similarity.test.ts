import { describe, expect, test } from "bun:test"
import { similarity } from "../../src/loop/similarity"

describe("similarity", () => {
  // The regression: two empty outputs scored 1, so the no-progress guard read
  // a turn that produced nothing as the model repeating itself. Combined with
  // toolCalls being 0 for the same reason, three empty turns finalized a
  // healthy loop as "stalled" seconds after it started.
  test("empty on both sides is absence of output, not repetition", () => {
    expect(similarity("", "")).toBe(0)
    expect(similarity("   ", "\n\t ")).toBe(0)
  })

  test("empty against non-empty is not similar", () => {
    expect(similarity("", "did the thing")).toBe(0)
    expect(similarity("did the thing", "")).toBe(0)
  })

  test("identical non-empty output is still fully similar", () => {
    expect(similarity("ran the tests", "ran the tests")).toBe(1)
  })

  test("normalization still collapses whitespace and case", () => {
    expect(similarity("Ran   The Tests", "ran the tests")).toBe(1)
  })

  test("near-identical output scores above the no-progress threshold", () => {
    // 0.92 is NoProgressSimilarityThreshold in loop.ts.
    expect(similarity("still working on the parser", "still working on the parser.")).toBeGreaterThan(0.92)
  })

  test("unrelated output scores low", () => {
    expect(similarity("ran the tests", "deleted four files")).toBeLessThan(0.5)
  })
})
