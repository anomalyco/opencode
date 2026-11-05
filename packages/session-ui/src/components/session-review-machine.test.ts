import { describe, expect, test } from "bun:test"
import {
  createSessionReviewState,
  DISPOSED_SESSION_REVIEW_EVENT,
  MEASURE_REQUESTED_EVENT,
  selectSessionReviewFileBody,
  selectSessionReviewOpen,
  transitionSessionReview,
  type SessionReviewEvent,
  type SessionReviewState,
} from "./session-review-machine"

const files = ["a.ts", "b.ts"]

function body(
  state: SessionReviewState,
  file: string,
  input: { changedLines?: number; isMedia?: boolean; pinned?: boolean } = {},
) {
  return selectSessionReviewFileBody(state, {
    file,
    canRender: true,
    changedLines: input.changedLines ?? 10,
    isMedia: input.isMedia ?? false,
    pinned: input.pinned ?? false,
  })
}

function replay(state: SessionReviewState, events: SessionReviewEvent[]) {
  return events.reduce((current, event) => transitionSessionReview(current, event).state, state)
}

function mountedOf(state: SessionReviewState) {
  return state.status === "active" ? state.mounted : new Set<string>()
}

function measured(...visible: string[]): SessionReviewEvent {
  return { type: "viewport.measured", visible: new Set(visible) }
}

const uncontrolled = createSessionReviewState(files, undefined)

describe("transitionSessionReview", () => {
  // A hidden (0x0) review used to mount every open diff; one that grew into view without a scroll mounted none.
  test("a hidden review mounts nothing until a resize brings files into view", () => {
    const opened = transitionSessionReview(uncontrolled, { type: "open.changed", files })

    expect(opened.effects).toEqual([{ type: "notify-open", files }, { type: "schedule-measure" }])

    const hidden = transitionSessionReview(opened.state, { type: "viewport.measured", visible: null })

    expect(body(hidden.state, "a.ts")).toBe("placeholder")
    expect(body(hidden.state, "b.ts")).toBe("placeholder")

    const resized = transitionSessionReview(hidden.state, MEASURE_REQUESTED_EVENT)

    expect(resized.effects).toEqual([{ type: "schedule-measure" }])

    const shown = transitionSessionReview(resized.state, measured("a.ts")).state

    expect(body(shown, "a.ts")).toBe("mounted")
    expect(body(shown, "b.ts")).toBe("placeholder")
  })

  // Every scrolled frame used to write the store once a file had left the viewport.
  test("scrolling coalesces measurements and keeps mounted diffs without new state", () => {
    const shown = replay(uncontrolled, [{ type: "open.changed", files }, measured("a.ts")])
    const queued = transitionSessionReview(shown, MEASURE_REQUESTED_EVENT).state

    const again = transitionSessionReview(queued, MEASURE_REQUESTED_EVENT)

    expect(again.state).toBe(queued)
    expect(again.effects).toEqual([])

    const scrolledPast = transitionSessionReview(queued, measured()).state

    expect(mountedOf(scrolledPast)).toBe(mountedOf(shown))
    expect(body(scrolledPast, "a.ts")).toBe("mounted")

    const settled = transitionSessionReview(scrolledPast, measured("a.ts"))

    expect(settled.state).toBe(scrolledPast)

    const down = replay(scrolledPast, [MEASURE_REQUESTED_EVENT, measured("b.ts")])

    expect(body(down, "a.ts")).toBe("mounted")
    expect(body(down, "b.ts")).toBe("mounted")
  })

  test("collapsing a file unmounts it, and removing it forgets it", () => {
    const shown = replay(uncontrolled, [
      { type: "open.changed", files },
      measured("a.ts", "b.ts"),
      { type: "force.requested", file: "a.ts" },
    ])

    const collapsed = transitionSessionReview(shown, { type: "open.changed", files: ["b.ts"] }).state
    const reopened = transitionSessionReview(collapsed, { type: "open.changed", files }).state

    expect(body(collapsed, "a.ts")).toBe("collapsed")
    // Off screen, a file opened again starts as a placeholder; "Render anyway" still holds while the file exists.
    expect(body(reopened, "a.ts", { changedLines: 600 })).toBe("placeholder")

    const removed = transitionSessionReview(shown, { type: "props.synced", files: ["b.ts"], open: undefined }).state

    expect(selectSessionReviewOpen(removed)).toEqual(["b.ts"])
    expect([...mountedOf(removed)]).toEqual(["b.ts"])
    expect(removed.status === "active" ? removed.forced.size : -1).toBe(0)
  })

  // "Render anyway" used to flash the placeholder for a frame before the diff mounted.
  test("render anyway mounts a large diff at once", () => {
    const opened = transitionSessionReview(uncontrolled, { type: "open.changed", files: ["a.ts"] }).state

    expect(body(opened, "a.ts", { changedLines: 600 })).toBe("too-large")

    const forced = transitionSessionReview(opened, { type: "force.requested", file: "a.ts" }).state

    expect(body(forced, "a.ts", { changedLines: 600 })).toBe("mounted")
    expect(transitionSessionReview(forced, { type: "force.requested", file: "a.ts" }).state).toBe(forced)
    expect(transitionSessionReview(forced, { type: "force.requested", file: "b.ts" }).state).toBe(forced)
  })

  test("a controlled review asks its parent and follows the open prop", () => {
    const controlled = createSessionReviewState(files, [])
    const asked = transitionSessionReview(controlled, { type: "open.changed", files: ["a.ts", "a.ts"] })

    expect(asked.state).toBe(controlled)
    expect(asked.effects).toEqual([{ type: "notify-open", files: ["a.ts"] }])

    const synced = transitionSessionReview(controlled, { type: "props.synced", files, open: ["a.ts"] })

    expect(selectSessionReviewOpen(synced.state)).toEqual(["a.ts"])
    expect(synced.effects).toEqual([{ type: "schedule-measure" }])
    expect(
      transitionSessionReview(synced.state, { type: "props.synced", files: [...files], open: ["a.ts"] }).state,
    ).toBe(synced.state)
  })

  test("pinned files and media mount ahead of the viewport and the size limit", () => {
    const opened = transitionSessionReview(uncontrolled, { type: "open.changed", files }).state

    expect(body(opened, "a.ts", { pinned: true })).toBe("mounted")
    expect(body(opened, "a.ts", { changedLines: 600, isMedia: true, pinned: true })).toBe("mounted")
    expect(
      selectSessionReviewFileBody(opened, {
        file: "a.ts",
        canRender: false,
        changedLines: 0,
        isMedia: false,
        pinned: true,
      }),
    ).toBe("collapsed")
  })

  test("closing every file or unmounting cancels a queued measurement", () => {
    const queued = replay(uncontrolled, [{ type: "open.changed", files }])

    expect(transitionSessionReview(queued, { type: "open.changed", files: [] }).effects).toEqual([
      { type: "notify-open", files: [] },
      { type: "cancel-measure" },
    ])

    const disposed = transitionSessionReview(queued, DISPOSED_SESSION_REVIEW_EVENT)

    expect(disposed.effects).toEqual([{ type: "cancel-measure" }])
    expect(transitionSessionReview(disposed.state, MEASURE_REQUESTED_EVENT)).toEqual({
      state: disposed.state,
      effects: [],
    })
    expect(selectSessionReviewOpen(disposed.state)).toEqual([])
  })
})
