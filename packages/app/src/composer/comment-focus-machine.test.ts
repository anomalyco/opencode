import { describe, expect, test } from "bun:test"
import {
  commentActiveTarget,
  commentFocusTarget,
  INITIAL_COMMENT_FOCUS_STATE,
  transitionCommentFocus,
  type CommentFocusEffect,
  type CommentFocusEvent,
  type CommentFocusState,
} from "./comment-focus-machine"

const a = { file: "a.ts", id: "c1" }

const b = { file: "b.ts", id: "c2" }

function run(events: CommentFocusEvent[], state: CommentFocusState = INITIAL_COMMENT_FOCUS_STATE) {
  return events.reduce<{ state: CommentFocusState; effects: CommentFocusEffect[] }>(
    (current, event) => {
      const step = transitionCommentFocus(current.state, event)

      return { state: step.state, effects: [...current.effects, ...step.effects] }
    },
    { state, effects: [] },
  )
}

describe("comment focus handoff", () => {
  test("a request waits for its view however late it mounts, and one acknowledgement settles it", () => {
    const opened = transitionCommentFocus(INITIAL_COMMENT_FOCUS_STATE, { type: "comment.opened", target: a })
    expect(opened.state).toEqual({ status: "pending", attempt: 1, target: a, active: a })
    expect(opened.effects).toEqual([{ type: "timer.start", attempt: 1 }])

    const acknowledged = transitionCommentFocus(opened.state, { type: "focus.set", target: null })
    expect(acknowledged.state).toEqual({ status: "idle", attempt: 1, active: a })
    expect(acknowledged.effects).toEqual([{ type: "timer.clear" }])
    expect(commentFocusTarget(acknowledged.state)).toBeNull()
    expect(commentActiveTarget(acknowledged.state)).toEqual(a)

    // The old retry loop requested the same comment again after the view had revealed it.
    const repeated = transitionCommentFocus(acknowledged.state, { type: "focus.set", target: null })
    expect(repeated.state).toBe(acknowledged.state)
  })

  test("a newer request wins over the older one's timeout", () => {
    const step = run([
      { type: "comment.opened", target: a },
      { type: "comment.opened", target: b },
      { type: "focus.timed-out", attempt: 1 },
    ])

    expect(step.state).toEqual({ status: "pending", attempt: 2, target: b, active: b })

    const timedOut = transitionCommentFocus(step.state, { type: "focus.timed-out", attempt: 2 })
    expect(timedOut.state).toEqual({ status: "idle", attempt: 2, active: b })
    expect(timedOut.effects).toEqual([{ type: "timer.clear" }])
  })

  test("a request for the comment already pending keeps its attempt and timer", () => {
    const pending = run([{ type: "comment.opened", target: a }]).state

    for (const event of [
      { type: "comment.opened", target: { ...a } },
      { type: "focus.set", target: { ...a } },
      { type: "active.set", target: { ...a } },
    ] satisfies CommentFocusEvent[]) {
      const step = transitionCommentFocus(pending, event)
      expect(step.state).toBe(pending)
      expect(step.effects).toEqual([])
    }
  })

  test("a new comment asks for focus without changing the active comment", () => {
    const step = run([
      { type: "active.set", target: a },
      { type: "focus.set", target: b },
    ])

    expect(step.state).toEqual({ status: "pending", attempt: 1, target: b, active: a })
  })

  test("removing the pending comment settles it; removing another comment does not", () => {
    const pending = run([{ type: "comment.opened", target: a }]).state
    expect(transitionCommentFocus(pending, { type: "comment.removed", target: b }).state).toBe(pending)

    const removed = transitionCommentFocus(pending, { type: "comment.removed", target: { ...a } })
    expect(removed.state).toEqual({ status: "idle", attempt: 1, active: a })
    expect(removed.effects).toEqual([{ type: "timer.clear" }])
  })

  test("a reset clears the request and the active comment", () => {
    const step = run([{ type: "comment.opened", target: a }, { type: "comments.reset" }])
    expect(step.state).toEqual({ status: "idle", attempt: 1, active: null })
    expect(step.effects).toEqual([{ type: "timer.start", attempt: 1 }, { type: "timer.clear" }])

    expect(transitionCommentFocus(step.state, { type: "comments.reset" }).state).toBe(step.state)
  })

  test("disposal cancels the timer and ignores everything after it", () => {
    const disposed = run([{ type: "comment.opened", target: a }, { type: "disposed" }])
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects.at(-1)).toEqual({ type: "timer.clear" })
    expect(commentFocusTarget(disposed.state)).toBeNull()
    expect(commentActiveTarget(disposed.state)).toBeNull()

    for (const event of [
      { type: "focus.set", target: b },
      { type: "focus.timed-out", attempt: 1 },
      { type: "comment.opened", target: b },
    ] satisfies CommentFocusEvent[])
      expect(transitionCommentFocus(disposed.state, event).state).toBe(disposed.state)
  })
})
