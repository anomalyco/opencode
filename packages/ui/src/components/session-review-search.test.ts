import { describe, expect, test } from "bun:test"
import { buildSessionSearchHits, stepSessionSearchIndex } from "./session-review-search"

describe("session review search", () => {
  test("builds hits with line, col, and side", () => {
    const hits = buildSessionSearchHits({
      query: "alpha",
      files: [
        {
          file: "a.txt",
          before: "alpha\nbeta alpha",
          after: "ALPHA",
        },
      ],
    })

    expect(hits).toEqual([
      { file: "a.txt", side: "deletions", line: 1, col: 1, len: 5 },
      { file: "a.txt", side: "deletions", line: 2, col: 6, len: 5 },
      { file: "a.txt", side: "additions", line: 1, col: 1, len: 5 },
    ])
  })

  test("uses non-overlapping matches", () => {
    const hits = buildSessionSearchHits({
      query: "aa",
      files: [{ file: "a.txt", after: "aaaa" }],
    })

    expect(hits.map((hit) => hit.col)).toEqual([1, 3])
  })

  test("wraps next and previous navigation", () => {
    expect(stepSessionSearchIndex(5, 0, -1)).toBe(4)
    expect(stepSessionSearchIndex(5, 4, 1)).toBe(0)
    expect(stepSessionSearchIndex(5, 2, 1)).toBe(3)
    expect(stepSessionSearchIndex(0, 0, 1)).toBe(0)
  })
})
