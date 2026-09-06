import { describe, expect, test } from "bun:test"
import { anchorParagraphIndex, availableCommentActions } from "./office-preview-model"

describe("office preview comment actions", () => {
  test("open comment without suggestion offers resolve, deny, edit, delete", () => {
    expect(availableCommentActions({ status: "open" })).toEqual(["resolve", "deny", "edit", "delete"])
  })

  test("open comment with suggestion adds approve", () => {
    expect(availableCommentActions({ status: "open", suggestedText: "fix" })).toEqual([
      "resolve",
      "deny",
      "approve",
      "edit",
      "delete",
    ])
  })

  test("resolved and denied comments only offer delete", () => {
    expect(availableCommentActions({ status: "resolved" })).toEqual(["delete"])
    expect(availableCommentActions({ status: "denied", suggestedText: "x" })).toEqual(["delete"])
  })
})

describe("office preview anchor parsing", () => {
  test("parses numeric paragraph anchors", () => {
    expect(anchorParagraphIndex("3")).toBe(3)
    expect(anchorParagraphIndex("0")).toBe(0)
    expect(anchorParagraphIndex("3:12")).toBe(3)
    expect(anchorParagraphIndex("0:0")).toBe(0)
    expect(anchorParagraphIndex("1.5")).toBeUndefined()
    expect(anchorParagraphIndex("-1")).toBeUndefined()
    expect(anchorParagraphIndex("nope")).toBeUndefined()
    expect(anchorParagraphIndex(undefined)).toBeUndefined()
  })
})
