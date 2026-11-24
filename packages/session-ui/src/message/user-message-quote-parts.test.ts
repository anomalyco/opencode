import { describe, expect, test } from "bun:test"
import { commentSegments, selectionLabel } from "./user-message-quote-parts"

describe("commentSegments", () => {
  test("marks @path mentions and keeps the text around them", () => {
    expect(commentSegments("compare with @packages/app/src/pinned.tsx first")).toEqual([
      { text: "compare with ", mention: false },
      { text: "@packages/app/src/pinned.tsx", mention: true },
      { text: " first", mention: false },
    ])
  })

  test("leaves a lone @ and plain text alone", () => {
    expect(commentSegments("email me @ noon")).toEqual([{ text: "email me @ noon", mention: false }])
  })
})

describe("selectionLabel", () => {
  test("names a range, a single line, or nothing for a whole file", () => {
    expect(selectionLabel({ startLine: 118, endLine: 124 })).toBe(":118-124")
    expect(selectionLabel({ startLine: 42, endLine: 42 })).toBe(":42")
    expect(selectionLabel(undefined)).toBe("")
  })
})
