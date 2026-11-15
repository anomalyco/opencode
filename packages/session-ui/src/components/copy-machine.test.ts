import { describe, expect, test } from "bun:test"
import {
  COPY_FEEDBACK_MS,
  INITIAL_COPY_FEEDBACK_STATE,
  transitionCopyFeedback,
  viewCopyFeedback,
  type CopyFeedbackEvent,
  type CopyFeedbackState,
} from "./copy-machine"

function replay(events: CopyFeedbackEvent[], state = INITIAL_COPY_FEEDBACK_STATE) {
  return events.reduce<CopyFeedbackState>((current, event) => transitionCopyFeedback(current, event).state, state)
}

describe("transitionCopyFeedback", () => {
  test("a second click inside the feedback window keeps Copied until its own reset", () => {
    const copied = replay([
      { type: "copy.requested", text: "a" },
      { type: "copy.succeeded", attempt: 1 },
    ])

    const again = transitionCopyFeedback(copied, { type: "copy.requested", text: "b" })

    expect(again.effects).toEqual([{ type: "clear-reset" }, { type: "write", attempt: 2, text: "b" }])
    expect(viewCopyFeedback(again.state).copied).toBe(true)
    // The first click's timer fires 2 s after it, while the second click's feedback is still showing.
    expect(transitionCopyFeedback(again.state, { type: "reset.due", attempt: 1 }).state).toBe(again.state)

    const settled = transitionCopyFeedback(again.state, { type: "copy.succeeded", attempt: 2 })

    expect(settled.effects).toEqual([{ type: "schedule-reset", attempt: 2, delayMs: COPY_FEEDBACK_MS }])
    expect(transitionCopyFeedback(settled.state, { type: "reset.due", attempt: 1 }).state).toBe(settled.state)
    expect(viewCopyFeedback(replay([{ type: "reset.due", attempt: 2 }], settled.state)).copied).toBe(false)
  })

  test("a failed write settles without Copied, and empty text starts nothing", () => {
    const copying = replay([{ type: "copy.requested", text: "a" }])

    expect(viewCopyFeedback(copying).copied).toBe(false)
    expect(replay([{ type: "copy.failed", attempt: 1 }], copying)).toEqual({ status: "idle", attempts: 1 })

    const empty = transitionCopyFeedback(INITIAL_COPY_FEEDBACK_STATE, { type: "copy.requested", text: "" })

    expect(empty.state).toBe(INITIAL_COPY_FEEDBACK_STATE)
    expect(empty.effects).toEqual([])
  })

  test("a newer click supersedes a write still in flight", () => {
    const state = replay([
      { type: "copy.requested", text: "a" },
      { type: "copy.requested", text: "b" },
    ])

    expect(state).toEqual({ status: "copying", attempt: 2, copied: false })
    expect(transitionCopyFeedback(state, { type: "copy.succeeded", attempt: 1 }).state).toBe(state)
    expect(transitionCopyFeedback(state, { type: "copy.failed", attempt: 1 }).state).toBe(state)
  })

  test("dispose clears the reset timer and ignores a late write", () => {
    const copied = replay([
      { type: "copy.requested", text: "a" },
      { type: "copy.succeeded", attempt: 1 },
    ])

    const disposed = transitionCopyFeedback(copied, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "idle", attempts: 1 }, effects: [{ type: "clear-reset" }] })

    const writing = replay([{ type: "copy.requested", text: "b" }, { type: "disposed" }], disposed.state)

    expect(writing).toEqual({ status: "idle", attempts: 2 })
    expect(transitionCopyFeedback(writing, { type: "copy.succeeded", attempt: 2 }).state).toBe(writing)
  })
})
