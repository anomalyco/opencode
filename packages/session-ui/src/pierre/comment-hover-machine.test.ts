import { expect, test } from "bun:test"
import {
  DISPOSED_HOVER_COMMENT_STATE,
  INITIAL_HOVER_COMMENT_STATE,
  selectHoverActive,
  selectHoverLine,
  transitionHoverComment,
  type HoverCommentEvent,
  type HoverCommentSide,
} from "./comment-hover-machine"

const hover = (lineNumber?: number, side?: HoverCommentSide): HoverCommentEvent => ({
  type: "hover.synced",
  lineNumber,
  side,
})

test("keeps the last hovered line after the pointer leaves the code", () => {
  const hovered = transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover(12, "additions"))
  const left = transitionHoverComment(hovered, hover())

  expect(left).toBe(hovered)
  expect(selectHoverLine(left)).toEqual({ lineNumber: 12, side: "additions" })
  expect(selectHoverLine(transitionHoverComment(left, hover(12, "deletions")))).toEqual({
    lineNumber: 12,
    side: "deletions",
  })
})

test("returns the same state when the hovered line does not change", () => {
  const hovered = transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover(7, "deletions"))

  expect(transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover())).toBe(INITIAL_HOVER_COMMENT_STATE)
  expect(transitionHoverComment(hovered, hover(7, "deletions"))).toBe(hovered)
  expect(transitionHoverComment(DISPOSED_HOVER_COMMENT_STATE, hover(7))).toBe(DISPOSED_HOVER_COMMENT_STATE)
})

test("stops listening and forgets the line once disposed", () => {
  const disposed = transitionHoverComment(transitionHoverComment(INITIAL_HOVER_COMMENT_STATE, hover(3)), {
    type: "disposed",
  })

  expect(disposed).toBe(DISPOSED_HOVER_COMMENT_STATE)
  expect(selectHoverActive(disposed)).toBe(false)
  expect(selectHoverLine(disposed)).toBeUndefined()
  expect(transitionHoverComment(disposed, { type: "disposed" })).toBe(disposed)
})
