import { describe, expect, test } from "bun:test"
import {
  COMMENT_SELECTION_SETTLE_MS,
  createCommentSelectionState,
  selectCommentSelectionToolbar,
  transitionCommentSelection,
  type CommentSelectionEvent,
  type CommentSelectionSample,
  type CommentSelectionState,
  type CommentSelectionTransition,
} from "./comment-selection-machine"

const BOUNDS = { top: 0, bottom: 400, left: 0, right: 600 }

const SAMPLE: CommentSelectionSample = {
  range: { start: 3, end: 5 },
  bounds: BOUNDS,
  anchor: { top: 100, bottom: 160, start: 40, end: 300, single: false, backward: false },
}

const SIZE = { width: 120, height: 28 }

const replay = (
  events: readonly CommentSelectionEvent[],
  state: CommentSelectionState = createCommentSelectionState(),
) =>
  events.reduce<CommentSelectionTransition>((last, event) => transitionCommentSelection(last.state, event), {
    state,
    effects: [],
  })

const press = (inside = true, button = 0): CommentSelectionEvent => ({ type: "pointer.down", button, inside })

const released: CommentSelectionEvent = { type: "pointer.released" }

const changed: CommentSelectionEvent = { type: "selection.changed" }

const settled = (attempt: number, sample: CommentSelectionSample = SAMPLE): CommentSelectionEvent => ({
  type: "settle.sampled",
  attempt,
  sample,
})

const nothing = (attempt: number): CommentSelectionEvent => ({ type: "settle.sampled", attempt, sample: undefined })

const measured: CommentSelectionEvent = { type: "toolbar.measured", size: SIZE }

describe("comment selection toolbar", () => {
  test("a drag over the code offers the toolbar once the release settles", () => {
    const dragging = replay([press(), changed, changed])
    expect(dragging.state.status).toBe("pressing")
    expect(dragging.effects).toEqual([])

    const releasing = transitionCommentSelection(dragging.state, released)
    expect(releasing.effects).toEqual([{ type: "schedule-settle", attempt: 1, delayMs: COMMENT_SELECTION_SETTLE_MS }])
    expect(selectCommentSelectionToolbar(releasing.state)).toBeUndefined()

    const shown = replay([settled(1), measured], releasing.state)
    expect(selectCommentSelectionToolbar(shown.state)).toEqual({ place: { top: 168, left: 240 }, measured: true })
  })

  test("a click that leaves nothing selected offers nothing", () => {
    const step = replay([press(), released, nothing(1)])

    expect(step.state).toEqual({ status: "idle", issued: 1 })
    expect(selectCommentSelectionToolbar(step.state)).toBeUndefined()
  })

  test("a selection made outside the viewer schedules no work", () => {
    const step = replay([press(false), changed, released])

    expect(step.state.status).toBe("idle")
    expect(step.effects).toEqual([])
  })

  test("a new press drops the previous release's pending read", () => {
    const pressed = replay([press(), released, press()])
    expect(pressed.effects).toEqual([{ type: "cancel-settle" }])

    const stale = transitionCommentSelection(pressed.state, settled(1))
    expect(stale.state).toBe(pressed.state)
  })

  test("a press elsewhere closes the toolbar", () => {
    const step = replay([press(), released, settled(1), press(false)])

    expect(step.state.status).toBe("idle")
    expect(selectCommentSelectionToolbar(step.state)).toBeUndefined()
  })

  test("a secondary press keeps the toolbar, so a context menu can copy the text", () => {
    const shown = replay([press(), released, settled(1)])

    expect(transitionCommentSelection(shown.state, press(true, 2)).state).toBe(shown.state)
  })

  test("Add comment opens a draft on the selected lines and clears the text selection", () => {
    const step = replay([press(), released, settled(1), { type: "comment.added" }])

    expect(step.state.status).toBe("idle")
    expect(step.effects).toEqual([{ type: "clear-selection" }, { type: "open-draft", range: { start: 3, end: 5 } }])
  })

  test("Escape closes the toolbar and keeps the text selected", () => {
    const step = replay([press(), released, settled(1), { type: "escape" }])

    expect(step.state.status).toBe("idle")
    expect(step.effects).toEqual([])
  })

  test("a changed selection hides the toolbar until it settles again", () => {
    const changing = replay([press(), released, settled(1), changed])
    expect(selectCommentSelectionToolbar(changing.state)).toBeUndefined()
    expect(changing.effects).toEqual([{ type: "schedule-settle", attempt: 2, delayMs: COMMENT_SELECTION_SETTLE_MS }])

    const cleared = transitionCommentSelection(changing.state, nothing(2))
    expect(cleared.state.status).toBe("idle")
  })

  test("scrolling places the toolbar once per frame and hides it while the selection is out of view", () => {
    const shown = replay([press(), released, settled(1), measured])
    const scrolled = replay([{ type: "layout.changed" }, { type: "layout.changed" }], shown.state)
    expect(transitionCommentSelection(shown.state, { type: "layout.changed" }).effects).toEqual([
      { type: "schedule-place", attempt: 2 },
    ])
    expect(scrolled.effects).toEqual([])

    const away = transitionCommentSelection(scrolled.state, {
      type: "place.sampled",
      attempt: 2,
      sample: { ...SAMPLE, anchor: undefined },
    })

    expect(away.state.status).toBe("shown")
    expect(selectCommentSelectionToolbar(away.state)).toBeUndefined()

    const gone = replay(
      [{ type: "layout.changed" }, { type: "place.sampled", attempt: 3, sample: undefined }],
      away.state,
    )

    expect(gone.state.status).toBe("idle")
  })

  test("disposing cancels pending work and ignores later events", () => {
    const disposed = replay([press(), released, { type: "disposed" }])
    expect(disposed.effects).toEqual([{ type: "cancel-settle" }])
    expect(transitionCommentSelection(disposed.state, settled(1)).state).toBe(disposed.state)
  })
})

describe("comment selection toolbar position", () => {
  const place = (anchor: Partial<NonNullable<CommentSelectionSample["anchor"]>>, bounds = BOUNDS) =>
    selectCommentSelectionToolbar(
      replay([press(), released, settled(1, { ...SAMPLE, bounds, anchor: { ...SAMPLE.anchor!, ...anchor } }), measured])
        .state,
    )?.place

  test("sits centered above a one-line selection", () => {
    expect(place({ single: true, top: 100, bottom: 120, start: 100, end: 200 })).toEqual({ top: 64, left: 90 })
  })

  test("sits above the start of a selection dragged upwards", () => {
    expect(place({ backward: true })).toEqual({ top: 64, left: 8 })
  })

  test("flips to the other side when there is no room", () => {
    expect(place({ top: 300, bottom: 380 })).toEqual({ top: 264, left: 240 })
    expect(place({ single: true, top: 10, bottom: 30, start: 100, end: 200 })).toEqual({ top: 38, left: 90 })
  })

  test("docks centered at the viewer's bottom on touch screens, clear of their own selection menu", () => {
    const shown = replay([press(), released, settled(1), measured]).state

    expect(selectCommentSelectionToolbar(shown, true)?.place).toEqual({ top: 364, left: 240 })
  })

  test("pins to the viewer's bottom when neither side fits, and stays inside its edges", () => {
    expect(place({ top: 20, bottom: 390, end: 590 })).toEqual({ top: 364, left: 472 })
    expect(place({ end: 10 }, { ...BOUNDS, right: 100 })).toEqual({ top: 168, left: 8 })
  })
})
