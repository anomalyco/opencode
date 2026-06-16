import { describe, expect, test } from "bun:test"
import { lineRefSegments, lineRefToSelection, normLineRef } from "./line-reference-url"

describe("lineRefSegments", () => {
  test("mixed uses per-side line spans when present", () => {
    const parts = lineRefSegments({
      start: 5,
      end: 9,
      side: "deletions",
      endSide: "additions",
      additionStart: 2,
      additionEnd: 4,
      deletionStart: 1,
      deletionEnd: 3,
    })
    expect(parts).toEqual([
      { label: "L2–4", tone: "additions" },
      { label: "L1–3", tone: "deletions" },
    ])
  })

  test("mixed falls back to anchor lines without spans", () => {
    const parts = lineRefSegments({
      start: 5,
      end: 9,
      side: "deletions",
      endSide: "additions",
    })
    expect(parts).toEqual([
      { label: "L5", tone: "deletions" },
      { label: "L9", tone: "additions" },
    ])
  })

  test("lineRefToSelection maps diff spans", () => {
    expect(
      lineRefToSelection({
        start: 5,
        end: 9,
        side: "deletions",
        endSide: "additions",
        additionStart: 2,
        additionEnd: 4,
        deletionStart: 1,
        deletionEnd: 3,
      }),
    ).toEqual({
      start: 5,
      end: 9,
      side: "deletions",
      endSide: "additions",
      additionStart: 2,
      additionEnd: 4,
      deletionStart: 1,
      deletionEnd: 3,
    })
  })

  test("normLineRef swaps sides when lines invert", () => {
    expect(
      normLineRef({ start: 9, end: 5, side: "additions", endSide: "deletions" }),
    ).toEqual({ start: 5, end: 9, side: "deletions", endSide: "additions" })
  })
})
