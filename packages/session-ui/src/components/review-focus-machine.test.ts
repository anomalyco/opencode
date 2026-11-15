import { describe, expect, test } from "bun:test"
import {
  INITIAL_REVIEW_FOCUS_STATE,
  reviewFocusPinnedFile,
  transitionReviewFocus,
  type ReviewFocusEvent,
  type ReviewFocusState,
} from "./review-focus-machine"

const request = (file: string, commentId: string, available = true): ReviewFocusEvent => ({
  type: "focus.requested",
  file,
  commentId,
  available,
})

function replay(events: ReviewFocusEvent[], state = INITIAL_REVIEW_FOCUS_STATE) {
  return events.reduce<ReviewFocusState>((current, event) => transitionReviewFocus(current, event).state, state)
}

describe("transitionReviewFocus", () => {
  test("a second request supersedes the first, and only the current reveal acknowledges", () => {
    const first = transitionReviewFocus(INITIAL_REVIEW_FOCUS_STATE, request("a.ts", "c1"))

    // The old reveal acknowledged on the next frame, before the comment rendered, and could clear a newer request.
    expect(first.effects.map((effect) => effect.type)).not.toContain("acknowledge")
    expect(reviewFocusPinnedFile(first.state)).toBe("a.ts")

    const second = transitionReviewFocus(first.state, request("b.ts", "c2"))

    expect(second).toEqual({
      state: { status: "revealing", attempt: 2, file: "b.ts", commentId: "c2" },
      effects: [
        { type: "cancel-reveal" },
        { type: "open-comment", file: "b.ts", commentId: "c2" },
        { type: "expand-file", file: "b.ts" },
        { type: "reveal", attempt: 2 },
      ],
    })

    for (const late of [
      { type: "reveal.succeeded", attempt: 1 },
      { type: "reveal.timed-out", attempt: 1 },
    ] as const)
      expect(transitionReviewFocus(second.state, late)).toEqual({ state: second.state, effects: [] })

    expect(transitionReviewFocus(second.state, { type: "reveal.succeeded", attempt: 2 })).toEqual({
      state: { status: "settled", attempt: 2, file: "b.ts", commentId: "c2", outcome: "revealed" },
      effects: [
        { type: "cancel-reveal" },
        { type: "open-comment", file: "b.ts", commentId: "c2" },
        { type: "acknowledge", attempt: 2, deferred: false },
      ],
    })
  })

  test("a reveal that never finds the comment times out and acknowledges", () => {
    const step = transitionReviewFocus(replay([request("a.ts", "c1")]), { type: "reveal.timed-out", attempt: 1 })

    expect(step).toEqual({
      state: { status: "settled", attempt: 1, file: "a.ts", commentId: "c1", outcome: "timeout" },
      effects: [{ type: "cancel-reveal" }, { type: "acknowledge", attempt: 1, deferred: false }],
    })
    expect(reviewFocusPinnedFile(step.state)).toBeUndefined()
  })

  test("an unavailable target settles at once, and a newer request outranks its acknowledgement", () => {
    const missing = transitionReviewFocus(INITIAL_REVIEW_FOCUS_STATE, request("missing.ts", "c1", false))

    expect(missing).toEqual({
      state: { status: "settled", attempt: 1, file: "missing.ts", commentId: "c1", outcome: "unavailable" },
      effects: [{ type: "acknowledge", attempt: 1, deferred: true }],
    })

    expect(transitionReviewFocus(missing.state, request("b.ts", "c2")).state).toEqual({
      status: "revealing",
      attempt: 2,
      file: "b.ts",
      commentId: "c2",
    })
  })

  test("the same target again is ignored until the request is cleared", () => {
    const states = [
      replay([request("a.ts", "c1")]),
      replay([request("a.ts", "c1"), { type: "reveal.succeeded", attempt: 1 }]),
      replay([request("a.ts", "c1"), { type: "reveal.timed-out", attempt: 1 }]),
    ]

    for (const state of states)
      expect(transitionReviewFocus(state, request("a.ts", "c1"))).toEqual({ state, effects: [] })

    const again = transitionReviewFocus(
      replay([request("a.ts", "c1"), { type: "focus.cleared" }]),
      request("a.ts", "c1"),
    )

    expect(again.state).toEqual({ status: "revealing", attempt: 2, file: "a.ts", commentId: "c1" })
  })

  test("clearing or disposing stops the reveal and ignores its late results", () => {
    const revealing = replay([request("a.ts", "c1")])

    for (const exit of [{ type: "focus.cleared" }, { type: "disposed" }] as const) {
      const step = transitionReviewFocus(revealing, exit)

      expect(step).toEqual({ state: { status: "idle", attempt: 1 }, effects: [{ type: "cancel-reveal" }] })
      expect(transitionReviewFocus(step.state, { type: "reveal.succeeded", attempt: 1 }).state).toBe(step.state)
      expect(transitionReviewFocus(step.state, { type: "reveal.timed-out", attempt: 1 }).state).toBe(step.state)
    }

    expect(transitionReviewFocus(INITIAL_REVIEW_FOCUS_STATE, { type: "disposed" }).state).toBe(
      INITIAL_REVIEW_FOCUS_STATE,
    )
  })
})
