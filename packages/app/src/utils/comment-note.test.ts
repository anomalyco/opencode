import { describe, expect, test } from "bun:test"
import { readCommentMetadata } from "./comment-note"

describe("readCommentMetadata", () => {
  test("ignores selections with null coordinates", () => {
    const result = readCommentMetadata({
      opencodeComment: {
        path: "src/a.ts",
        comment: "check this",
        selection: { startLine: null, startChar: null, endLine: null, endChar: null },
      },
    })

    expect(result?.comment).toBe("check this")
    expect(result?.selection).toBeUndefined()
  })

  test("retains selections with finite numeric coordinates", () => {
    const selection = { startLine: 4, startChar: 0, endLine: 6, endChar: 2 }
    const result = readCommentMetadata({
      opencodeComment: { path: "src/a.ts", comment: "check this", selection },
    })

    expect(result?.selection).toEqual(selection)
  })
})
