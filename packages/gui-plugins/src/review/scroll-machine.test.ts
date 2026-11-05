import { describe, expect, test } from "bun:test"
import {
  INITIAL_REVIEW_SCROLL_STATE,
  REVIEW_SCROLL_MAX_FRAMES,
  transitionReviewScroll,
  type ReviewScrollContext,
  type ReviewScrollEffect,
  type ReviewScrollEvent,
  type ReviewScrollState,
} from "./scroll-machine"

const narrow: ReviewScrollContext = { visitID: 1, narrow: true, scroller: true, ready: true }

const wide: ReviewScrollContext = { visitID: 1, narrow: false, scroller: false, ready: true }

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

describe("the wide review", () => {
  test("keeps no focused file that the narrow list would scroll to later", () => {
    const focused = play(INITIAL_REVIEW_SCROLL_STATE, synced(wide), { type: "file.focused", path: "gamma.ts" })

    expect(focused.state.status).toBe("idle")

    const narrowed = play(focused.state, synced(narrow))

    expect(narrowed.state.status).toBe("idle")
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

    expect(loaded.effects).toEqual([{ type: "frame.schedule", attempt: 2, path: "a.ts" }])
  })

  test("scrolls on the next session's visit with the same list still mounted", () => {
    const first = play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" })

    expect(first.effects).toEqual([{ type: "frame.schedule", attempt: 1, path: "a.ts" }])

    const switched = play(first.state, synced({ ...narrow, visitID: 2 }))

    expect(switched.effects).toEqual([{ type: "frame.cancel" }])
    expect(switched.state.status).toBe("idle")

    const second = play(switched.state, { type: "file.focused", path: "b.ts" })

    expect(second.effects).toEqual([{ type: "frame.schedule", attempt: 3, path: "b.ts" }])
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
    expect(state.state.status).toBe("idle")
  })
})

describe("the frame loop", () => {
  test("settles once the diff stays at the top", () => {
    const state = play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" }, retry(1), {
      type: "frame.stepped",
      attempt: 1,
      outcome: "settled",
    })

    expect(state.effects).toEqual([
      { type: "frame.schedule", attempt: 1, path: "a.ts" },
      { type: "frame.schedule", attempt: 1, path: "a.ts" },
    ])
    expect(state.state.status).toBe("idle")
  })

  test(`gives up after ${REVIEW_SCROLL_MAX_FRAMES} more frames`, () => {
    const started = play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" }).state
    const retried = play(started, ...Array.from({ length: REVIEW_SCROLL_MAX_FRAMES }, () => retry(1)))

    expect(retried.effects).toHaveLength(REVIEW_SCROLL_MAX_FRAMES)
    expect(retried.state.status).toBe("scrolling")

    const last = play(retried.state, retry(1))

    expect(last.effects).toEqual([])
    expect(last.state.status).toBe("idle")
  })

  test("focusing the file again restarts the loop and its budget", () => {
    const halfway = play(
      INITIAL_REVIEW_SCROLL_STATE,
      synced(narrow),
      { type: "file.focused", path: "a.ts" },
      ...Array.from({ length: 40 }, () => retry(1)),
    ).state

    const again = play(halfway, { type: "file.focused", path: "a.ts" })

    expect(again.effects).toEqual([{ type: "frame.cancel" }, { type: "frame.schedule", attempt: 2, path: "a.ts" }])
    expect(again.state).toMatchObject({ status: "scrolling", retries: 0, attempt: 2 })
    expect(transitionReviewScroll(again.state, retry(1)).state).toBe(again.state)
  })

  test("user input and disposal cancel the frame and drop its late step", () => {
    const scrolling = play(INITIAL_REVIEW_SCROLL_STATE, synced(narrow), { type: "file.focused", path: "a.ts" }).state

    for (const event of [{ type: "interacted" }, { type: "disposed" }] satisfies ReviewScrollEvent[]) {
      const stopped = play(scrolling, event)

      expect(stopped.effects).toEqual([{ type: "frame.cancel" }])
      expect(transitionReviewScroll(stopped.state, retry(1)).state).toBe(stopped.state)
    }
  })

  test("the list unmounting stops the loop", () => {
    const state = play(
      INITIAL_REVIEW_SCROLL_STATE,
      synced(narrow),
      { type: "file.focused", path: "a.ts" },
      synced({ ...narrow, scroller: false }),
    )

    expect(state.effects.at(-1)).toEqual({ type: "frame.cancel" })
    expect(state.state.status).toBe("idle")
  })
})
