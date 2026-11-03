import { describe, expect, test } from "bun:test"
import { selectionAt } from "@betteroffice/xlsx/headless"
import {
  columnName,
  coverMerges,
  hiddenAt,
  lastCell,
  parseRange,
  parseSpans,
  settleMerges,
  skipHidden,
} from "./sheet-cells"

describe("columnName", () => {
  test("names columns as Excel does, up to the last one", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702, lastCell.col].map(columnName)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
      "XFD",
    ])
  })
})

describe("parseRange", () => {
  test("reads cells and ranges, absolute or not, in either corner order", () => {
    expect(parseRange("B2")).toEqual({ top: 1, left: 1, bottom: 1, right: 1 })
    expect(parseRange("A1:F20")).toEqual({ top: 0, left: 0, bottom: 19, right: 5 })
    expect(parseRange("$F$20:a1")).toEqual({ top: 0, left: 0, bottom: 19, right: 5 })
    expect(parseRange("XFD1048576")).toEqual({
      top: lastCell.row,
      left: lastCell.col,
      bottom: lastCell.row,
      right: lastCell.col,
    })
  })

  test("rejects anything else, including cells past the sheet", () => {
    expect(parseRange("")).toBeUndefined()
    expect(parseRange("A0")).toBeUndefined()
    expect(parseRange("1A")).toBeUndefined()
    expect(parseRange("XFE1")).toBeUndefined()
    expect(parseRange("A1048577")).toBeUndefined()
    expect(parseRange("A1:")).toBeUndefined()
    expect(parseRange("Sheet1!A1")).toBeUndefined()
  })
})

describe("parseSpans", () => {
  test("reads hidden row and column spans and drops malformed ones", () => {
    expect(parseSpans(["5:7", "10", "0:1", "9:8", "x"], "rows")).toEqual([
      { start: 4, end: 6 },
      { start: 9, end: 9 },
    ])
    expect(parseSpans(["C:D", "AA", "D:C", "1:2"], "columns")).toEqual([
      { start: 2, end: 3 },
      { start: 26, end: 26 },
    ])
  })
})

describe("hiddenAt", () => {
  test("tells whether an index lies in a span, ends included", () => {
    const spans = [{ start: 2, end: 4 }]

    expect([1, 2, 3, 4, 5].map((index) => hiddenAt(spans, index))).toEqual([false, true, true, true, false])
  })
})

describe("coverMerges", () => {
  test("grows a range over every merge it touches, including merges a grown range reaches", () => {
    // The range reaches the first merge only once the second has grown it.
    const merges = [
      { top: 1, left: 2, bottom: 4, right: 3 },
      { top: 0, left: 1, bottom: 1, right: 2 },
      { top: 10, left: 10, bottom: 11, right: 11 },
    ]

    expect(coverMerges({ top: 0, left: 0, bottom: 0, right: 1 }, merges)).toEqual({
      top: 0,
      left: 0,
      bottom: 4,
      right: 3,
    })
    expect(coverMerges({ top: 6, left: 6, bottom: 7, right: 7 }, merges)).toEqual({
      top: 6,
      left: 6,
      bottom: 7,
      right: 7,
    })
  })
})

describe("settleMerges", () => {
  const merges = [{ top: 2, left: 2, bottom: 4, right: 3 }]

  test("selects a merge's first cell when a move lands in it", () => {
    expect(settleMerges(selectionAt({ row: 1, col: 3 }), selectionAt({ row: 2, col: 3 }), merges)).toEqual(
      selectionAt({ row: 2, col: 2 }),
    )
  })

  test("steps past the merge it started in, in the direction of the move", () => {
    expect(settleMerges(selectionAt({ row: 2, col: 2 }), selectionAt({ row: 3, col: 2 }), merges)).toEqual(
      selectionAt({ row: 5, col: 2 }),
    )
    expect(settleMerges(selectionAt({ row: 2, col: 2 }), selectionAt({ row: 2, col: 1 }), merges)).toEqual(
      selectionAt({ row: 2, col: 1 }),
    )
    expect(settleMerges(selectionAt({ row: 2, col: 2 }), selectionAt({ row: 2, col: 3 }), merges)).toEqual(
      selectionAt({ row: 2, col: 4 }),
    )
  })

  test("leaves a range selection and a move clear of merges as they are", () => {
    const range = { anchor: { row: 0, col: 0 }, focus: { row: 3, col: 3 } }
    const clear = selectionAt({ row: 8, col: 8 })

    expect(settleMerges(selectionAt({ row: 0, col: 0 }), range, merges)).toBe(range)
    expect(settleMerges(selectionAt({ row: 7, col: 8 }), clear, merges)).toBe(clear)
  })
})

describe("skipHidden", () => {
  const hidden = { rows: [{ start: 2, end: 3 }], columns: [{ start: 0, end: 1 }] }

  test("moves on past hidden rows in the direction of the move", () => {
    expect(skipHidden({ row: 1, col: 4 }, selectionAt({ row: 2, col: 4 }), hidden)).toEqual(
      selectionAt({ row: 4, col: 4 }),
    )
    expect(skipHidden({ row: 4, col: 4 }, selectionAt({ row: 3, col: 4 }), hidden)).toEqual(
      selectionAt({ row: 1, col: 4 }),
    )
  })

  test("stays where it started when only hidden cells lie ahead", () => {
    expect(skipHidden({ row: 0, col: 2 }, selectionAt({ row: 0, col: 1 }), hidden)).toEqual(
      selectionAt({ row: 0, col: 2 }),
    )
  })

  test("keeps a range's anchor and a selection already clear", () => {
    const range = { anchor: { row: 0, col: 4 }, focus: { row: 2, col: 4 } }
    const clear = selectionAt({ row: 6, col: 6 })

    expect(skipHidden({ row: 1, col: 4 }, range, hidden)).toEqual({
      anchor: { row: 0, col: 4 },
      focus: { row: 4, col: 4 },
    })
    expect(skipHidden({ row: 5, col: 6 }, clear, hidden)).toBe(clear)
  })
})
