import { describe, expect, test } from "bun:test"
import { normalizeContextMenuParams } from "./context-menu"

describe("normalizeContextMenuParams", () => {
  test("defaults missing dictionary suggestions to an empty list", () => {
    const params = {}

    normalizeContextMenuParams(params)

    expect(params.dictionarySuggestions).toEqual([])
  })

  test("preserves dictionary suggestions supplied by Electron", () => {
    const params = { dictionarySuggestions: ["spelling"] }

    normalizeContextMenuParams(params)

    expect(params.dictionarySuggestions).toEqual(["spelling"])
  })
})
