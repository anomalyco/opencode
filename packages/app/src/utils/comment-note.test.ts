import { describe, expect, test } from "bun:test"
import { readCommentMetadata } from "./comment-note"

const metadata = (selection: unknown) => ({
  opencodeComment: {
    path: "src/index.ts",
    selection,
    comment: "look here",
  },
})

describe("readCommentMetadata", () => {
  test("keeps a valid numeric selection", () => {
    const result = readCommentMetadata(metadata({ startLine: 4, startChar: 1, endLine: 6, endChar: 2 }))
    expect(result?.selection).toEqual({ startLine: 4, startChar: 1, endLine: 6, endChar: 2 })
  })

  test("treats null coordinates as no selection", () => {
    const result = readCommentMetadata(metadata({ startLine: null, startChar: null, endLine: null, endChar: null }))
    expect(result?.selection).toBeUndefined()
  })

  test("does not coerce non-numeric coordinates to line zero", () => {
    const selections = [
      { startLine: "", startChar: 0, endLine: 0, endChar: 0 },
      { startLine: false, startChar: 0, endLine: 0, endChar: 0 },
      { startLine: [], startChar: 0, endLine: 0, endChar: 0 },
    ]
    expect(selections.map((selection) => readCommentMetadata(metadata(selection))?.selection)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  test("rejects a partial or non-finite selection", () => {
    const invalid = [
      { startLine: 1, startChar: 0, endLine: 2 },
      { startLine: 1, startChar: 0, endLine: Number.POSITIVE_INFINITY, endChar: 0 },
    ]
    expect(invalid.map((selection) => readCommentMetadata(metadata(selection))?.selection)).toEqual([
      undefined,
      undefined,
    ])
  })

  test("keeps the comment when the selection is invalid", () => {
    const result = readCommentMetadata(metadata(null))
    expect(result?.path).toBe("src/index.ts")
    expect(result?.comment).toBe("look here")
    expect(result?.selection).toBeUndefined()
  })
})
