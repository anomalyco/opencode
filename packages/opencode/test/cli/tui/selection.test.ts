import { describe, expect, test } from "bun:test"
import { Selection } from "../../../src/cli/cmd/tui/util/selection"

describe("Selection.quote", () => {
  test("quotes each line and appends spacing", () => {
    expect(Selection.quote("original\nfew\nlines")).toBe("> original\n> few\n> lines\n\n")
  })

  test("normalizes windows line endings", () => {
    expect(Selection.quote("first\r\nsecond\rthird")).toBe("> first\n> second\n> third\n\n")
  })

  test("preserves blank lines inside selection", () => {
    expect(Selection.quote("first\n\nthird")).toBe("> first\n> \n> third\n\n")
  })
})
