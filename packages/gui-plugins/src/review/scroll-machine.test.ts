import { describe, expect, test } from "bun:test"
import {
  INITIAL_REVIEW_SCROLL_STATE,
  REVIEW_SCROLL_INTERACTED,
  REVIEW_SCROLL_MAX_FRAMES,
  REVIEW_SCROLL_RESTORE_REQUESTED,
  canRestoreReviewScroll,
  canSaveReviewScroll,
  transitionReviewScroll,
  type ReviewScrollContext,
  type ReviewScrollEffect,
  type ReviewScrollEvent,
  type ReviewScrollState,
} from "./scroll-machine"

// The layout has not loaded, so these cases scroll to files without restoring a stored scroll.
const narrow: ReviewScrollContext = {
  visitID: 1,
  narrow: true,
  scroller: true,
  ready: true,
  layoutReady: false,
  commentFocused: false,
}

const wide: ReviewScrollContext = { ...narrow, narrow: false, scroller: false }

const restorable: ReviewScrollContext = { ...narrow, layoutReady: true }

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewScrollState, ...events: ReviewScrollEvent[]) {
  return events.reduce<{ state: ReviewScrollState; effects: readonly ReviewScrollEffect[] }>(
    (result, event) => {
      const next = transitionReviewScroll(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function synced(context: ReviewScrollContext): ReviewScrollEvent {
  return { type: "context.synced", context }
}

function retry(attempt: number): ReviewScrollEvent {
  return { type: "frame.stepped", attempt, outcome: "retry" }
}

function stepped(attempt: number): ReviewScrollEvent {
  return { type: "restore.stepped", attempt }
}

describe("the wide review", () => {
  test("keeps no focused file that the narrow list would scroll to later", () => {
    const focused = play(INITIAL_REVIEW_SCROLL_STATE, synced(wide), { type: "file.focused", path: "gamma.ts" })

    expect(focused.state.status).toBe("restoring")

    const narrowed = play(focused.state, synced(narrow))

    expect(narrowed.state.status).toBe("restoring")
    expect([...focused.effects, ...narrowed.effects]).toEqual([])
  })
})

describe("the narrow review", () => {
  test("waits for the list and the diffs, then scrolls", () => {
    const waiting = play(INITIAL_REVIEW_SCROLL_STATE, synced({ ...narrow, scroller: false, ready: false }), {
      type: "file.focused",
      path: "a.ts",
    })

    expect(waiting.state.status).toBe("waiting")
    expect(waiting.effects).toEqual([])

    const loaded = play(waiting.state, synced({ ...narrow, scroller: false }), synced(narrow))

    expect(loaded.effects).toEqual([{ type: "frame.schedule", attempt: 3, path: "a.ts" }])
  })

  test("scrolls on the next session's visit with the same list still mounted", () => {
    const first = play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" })

    expect(first.effects).toEqual([{ type: "frame.schedule", attempt: 2, path: "a.ts" }])

    const switched = play(first.state, synced({ ...narrow, visitID: 2 }))

    expect(switched.effects).toEqual([{ type: "frame.cancel" }])
    expect(switched.state.status).toBe("restoring")

    const second = play(switched.state, { type: "file.focused", path: "b.ts" })

    expect(second.effects).toEqual([{ type: "frame.schedule", attempt: 4, path: "b.ts" }])
  })

  test("a file focused on one visit is not scrolled to on the next", () => {
    const state = play(
      INITIAL_REVIEW_SCROLL_STATE,
      synced({ ...narrow, scroller: false }),
      { type: "file.focused", path: "a.ts" },
      synced({ ...narrow, visitID: 2, scroller: false }),
      synced({ ...narrow, visitID: 2 }),
    )

    expect(state.effects).toEqual([])
    expect(state.state.status).toBe("restoring")
  })
})

describe("the frame loop", () => {
  const scrolling = () =>
    play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" }).state

  test("settles once the diff stays at the top", () => {
    const state = play(scrolling(), retry(2), { type: "frame.stepped", attempt: 2, outcome: "settled" })

    expect(state.effects).toEqual([{ type: "frame.schedule", attempt: 2, path: "a.ts" }])
    expect(state.state.status).toBe("settled")
  })

  test(`gives up after ${REVIEW_SCROLL_MAX_FRAMES} more frames`, () => {
    const retried = play(scrolling(), ...Array.from({ length: REVIEW_SCROLL_MAX_FRAMES }, () => retry(2)))

    expect(retried.effects).toHaveLength(REVIEW_SCROLL_MAX_FRAMES)
    expect(retried.state.status).toBe("scrolling")

    const last = play(retried.state, retry(2))

    expect(last.effects).toEqual([])
    expect(last.state.status).toBe("settled")
  })

  test("focusing the file again restarts the loop and its budget", () => {
    const halfway = play(scrolling(), ...Array.from({ length: 40 }, () => retry(2))).state
    const again = play(halfway, { type: "file.focused", path: "a.ts" })

    expect(again.effects).toEqual([{ type: "frame.cancel" }, { type: "frame.schedule", attempt: 3, path: "a.ts" }])
    expect(again.state).toMatchObject({ status: "scrolling", retries: 0, attempt: 3 })
    expect(transitionReviewScroll(again.state, retry(2)).state).toBe(again.state)
  })

  test("user input and disposal cancel the frame and drop its late step", () => {
    for (const event of [REVIEW_SCROLL_INTERACTED, { type: "disposed" }] satisfies ReviewScrollEvent[]) {
      const stopped = play(scrolling(), event)

      expect(stopped.effects).toEqual([{ type: "frame.cancel" }])
      expect(transitionReviewScroll(stopped.state, retry(2)).state).toBe(stopped.state)
    }
  })

  test("the list unmounting stops the loop", () => {
    const state = play(scrolling(), synced({ ...narrow, scroller: false }))

    expect(state.effects.at(-1)).toEqual({ type: "frame.cancel" })
    expect(state.state.status).toBe("restoring")
  })
})

describe("restoring the stored scroll", () => {
  test("waits for the layout and the list, then restores", () => {
    const waiting = play(INITIAL_REVIEW_SCROLL_STATE, synced({ ...restorable, scroller: false, layoutReady: false }))

    expect(waiting.effects).toEqual([])
    expect(play(waiting.state, REVIEW_SCROLL_RESTORE_REQUESTED).effects).toEqual([])

    const mounted = play(waiting.state, synced({ ...restorable, scroller: false }), synced(restorable))

    expect(mounted.effects).toEqual([{ type: "frame.restore", attempt: 2 }])
    expect(canRestoreReviewScroll(mounted.state, 2)).toBe(true)
    expect(canRestoreReviewScroll(mounted.state, 1)).toBe(false)
  })

  // A diff shorter than its placeholder clamped the list, and its scroll event looked like the user's: the restore
  // stopped and the clamped offset overwrote the stored one.
  test("keeps restoring across layout shifts and never stores their scroll", () => {
    const first = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable), stepped(1))

    expect(first.state).toMatchObject({ status: "restoring", restoreQueued: false })
    expect(canSaveReviewScroll(first.state)).toBe(false)

    const rendered = play(first.state, REVIEW_SCROLL_RESTORE_REQUESTED, stepped(2), REVIEW_SCROLL_RESTORE_REQUESTED)

    expect(rendered.effects).toEqual([
      { type: "frame.restore", attempt: 2 },
      { type: "frame.restore", attempt: 3 },
    ])
    expect(canSaveReviewScroll(rendered.state)).toBe(false)
  })

  test("coalesces requests into one frame and drops a stale step", () => {
    const queued = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable)).state

    expect(transitionReviewScroll(queued, REVIEW_SCROLL_RESTORE_REQUESTED).state).toBe(queued)
    expect(transitionReviewScroll(queued, stepped(0)).state).toBe(queued)
  })

  test("user input settles the list, so its scroll is stored, without allocating again", () => {
    const settled = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable), REVIEW_SCROLL_INTERACTED)

    expect(settled.effects).toEqual([{ type: "frame.restore", attempt: 1 }, { type: "frame.cancel" }])
    expect(canSaveReviewScroll(settled.state)).toBe(true)
    expect(transitionReviewScroll(settled.state, REVIEW_SCROLL_INTERACTED).state).toBe(settled.state)
    expect(transitionReviewScroll(settled.state, REVIEW_SCROLL_RESTORE_REQUESTED).state).toBe(settled.state)
  })

  // Revealing a comment rendered its diff, which queued a restore that then scrolled away from the comment.
  test("a focused comment cancels the pending restore and keeps its position", () => {
    const queued = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable)).state
    const focused = play(queued, synced({ ...restorable, commentFocused: true }))

    expect(focused.effects).toEqual([{ type: "frame.cancel" }])
    expect(focused.state.status).toBe("settled")
    expect(canSaveReviewScroll(focused.state)).toBe(true)
    expect(play(focused.state, REVIEW_SCROLL_RESTORE_REQUESTED).effects).toEqual([])
  })

  // The narrow review restored the stored scroll in its own frame loop while a focused file scrolled the same list.
  test("a focused file replaces the restore, and later diff renders leave the file in place", () => {
    const queued = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable)).state
    const focused = play(queued, { type: "file.focused", path: "a.ts" })

    expect(focused.effects).toEqual([{ type: "frame.cancel" }, { type: "frame.schedule", attempt: 2, path: "a.ts" }])
    expect(transitionReviewScroll(focused.state, REVIEW_SCROLL_RESTORE_REQUESTED).state).toBe(focused.state)

    const settled = play(focused.state, { type: "frame.stepped", attempt: 2, outcome: "settled" })

    expect(settled.state.status).toBe("settled")
    expect(play(settled.state, REVIEW_SCROLL_RESTORE_REQUESTED).effects).toEqual([])
  })

  test("the list remounting on the same visit restores again", () => {
    const settled = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable), REVIEW_SCROLL_INTERACTED).state
    const remounted = play(settled, synced({ ...restorable, scroller: false }), synced(restorable))

    expect(remounted.effects).toEqual([{ type: "frame.restore", attempt: 3 }])
    expect(canSaveReviewScroll(remounted.state)).toBe(false)
  })

  test("the next visit restores its own scroll, and disposal cancels the frame", () => {
    const settled = play(INITIAL_REVIEW_SCROLL_STATE, synced(restorable), REVIEW_SCROLL_INTERACTED).state
    const next = play(settled, synced({ ...restorable, visitID: 2 }))

    expect(next.effects).toEqual([{ type: "frame.restore", attempt: 3 }])

    const disposed = play(next.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "frame.cancel" }])
    expect(transitionReviewScroll(disposed.state, stepped(3)).state).toBe(disposed.state)
  })
})
