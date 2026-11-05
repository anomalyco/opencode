import { describe, expect, test } from "bun:test"
import {
  INITIAL_PREVIEW_ZOOM_STATE,
  selectDragging,
  selectPanPointer,
  transitionPreviewZoom,
  type PreviewZoomEffect,
  type PreviewZoomEvent,
  type PreviewZoomState,
} from "./image-zoom-machine"

function replay(events: PreviewZoomEvent[], from = INITIAL_PREVIEW_ZOOM_STATE) {
  return events.reduce(
    (result, event) => {
      const next = transitionPreviewZoom(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: from, effects: [] as PreviewZoomEffect[] },
  )
}

function down(target: "viewport" | "video" | "content", options: { zoomed?: boolean; onBackdrop?: boolean } = {}) {
  return {
    type: "pointer.down",
    pointerId: 1,
    button: 0,
    target,
    onBackdrop: options.onBackdrop ?? false,
    zoomed: options.zoomed ?? true,
  } satisfies PreviewZoomEvent
}

const moved = { type: "pointer.moved", pointerId: 1 } satisfies PreviewZoomEvent
const up = { type: "pointer.up", pointerId: 1 } satisfies PreviewZoomEvent

describe("image preview zoom gesture", () => {
  // Bug: nothing ended a pan whose pointer capture was lost without a pointerup, so plain hover with the same mouse
  // pointer kept panning the image under a grabbing cursor. The driver sends `pointer.cancel` on lostpointercapture
  // and on a move with the primary button up.
  test("a pan that loses its pointer ends", () => {
    const panning = replay([down("viewport"), moved])

    expect(selectDragging(panning.state)).toBe(true)
    expect(panning.effects).toEqual([{ type: "pointer.capture", target: "viewport", pointerId: 1 }])

    const ended = transitionPreviewZoom(panning.state, { type: "pointer.cancel", pointerId: 1 })
    expect(selectDragging(ended.state)).toBe(false)
    expect(selectPanPointer(ended.state, 1)).toBe(false)
    expect(ended.effects).toEqual([{ type: "pointer.release", target: "viewport", pointerId: 1 }])
    expect(transitionPreviewZoom(ended.state, moved).state).toBe(ended.state)
  })

  // Bug: Escape or 0 during a press glided back to fit and left the pan, and its grabbing cursor, on a fitted image.
  test("an eased zoom takes over from a pan", () => {
    const glide = replay([down("viewport"), moved, { type: "glide.start" }])

    expect(glide.state).toEqual({ status: "gliding", gesture: { type: "idle" } })
    expect(glide.effects.slice(1)).toEqual([
      { type: "pointer.release", target: "viewport", pointerId: 1 },
      { type: "glide.loop.start" },
    ])
  })

  test("a press does not stop a glide, the hand moving does, and a pan ends once the image is back at fit", () => {
    const pressed = replay([{ type: "glide.start" }, down("viewport")])

    expect(pressed.state.status).toBe("gliding")
    expect(selectDragging(pressed.state)).toBe(true)

    const followed = transitionPreviewZoom(pressed.state, { type: "follow", zoomed: true })
    expect(followed.state.status).toBe("still")
    expect(followed.effects).toEqual([{ type: "glide.loop.stop" }])

    const settled = transitionPreviewZoom(pressed.state, { type: "glide.settled", zoomed: false })
    expect(settled.state).toEqual({ status: "still", gesture: { type: "idle" } })
    expect(settled.effects).toEqual([
      { type: "glide.loop.stop" },
      { type: "pointer.release", target: "viewport", pointerId: 1 },
    ])
  })

  // Bug: the "panned" flag outlived its gesture, so a later click on the video's controls was swallowed.
  test("only the release of a moved video pan swallows its click", () => {
    expect(replay([down("video"), moved, up]).effects.at(-1)).toEqual({ type: "video.suppress-click" })
    expect(replay([down("video"), up]).effects).toEqual([{ type: "pointer.capture", target: "video", pointerId: 1 }])
    expect(replay([down("video"), moved, { type: "pointer.cancel", pointerId: 1 }]).effects.at(-1)).toEqual({
      type: "pointer.release",
      target: "video",
      pointerId: 1,
    })
  })

  test.each([
    ["an unzoomed press on the backdrop", [down("viewport", { zoomed: false, onBackdrop: true })], true],
    ["a press on the band around the body", [down("content", { onBackdrop: true })], true],
    ["a zoomed press on the backdrop that stays put", [down("viewport", { onBackdrop: true }), up], true],
    [
      "a zoomed press on the backdrop that stays put, then loses capture",
      [down("viewport", { onBackdrop: true }), up, { type: "pointer.cancel", pointerId: 1 } satisfies PreviewZoomEvent],
      true,
    ],
    ["a zoomed press on the image, whose captured click lands on the backdrop", [down("viewport"), up], false],
    ["a zoomed press on the backdrop that pans", [down("viewport", { onBackdrop: true }), moved, up], false],
    ["a press on a control", [down("content")], false],
  ])("%s closes the preview on click: %p", (_, events, closes) => {
    const pressed = replay(events)
    const clicked = transitionPreviewZoom(pressed.state, { type: "backdrop.click", onBackdrop: true })

    expect(clicked.effects).toEqual(closes ? [{ type: "dialog.close" }] : [])
  })

  test("a secondary button or a second pointer leaves the pan alone; the same pointer again starts over", () => {
    const panning = replay([down("viewport"), moved]).state

    expect(transitionPreviewZoom(panning, { ...down("viewport"), pointerId: 2 }).state).toBe(panning)
    expect(transitionPreviewZoom(panning, { type: "pointer.up", pointerId: 2 }).state).toBe(panning)
    expect(transitionPreviewZoom(INITIAL_PREVIEW_ZOOM_STATE, { ...down("viewport"), button: 2 }).state).toBe(
      INITIAL_PREVIEW_ZOOM_STATE,
    )

    const again = transitionPreviewZoom(panning, down("viewport"))
    expect(again.state).toEqual({
      status: "still",
      gesture: { type: "panning", pointerId: 1, target: "viewport", onBackdrop: false, moved: false },
    })
    expect(again.effects).toEqual([{ type: "pointer.capture", target: "viewport", pointerId: 1 }])
  })

  test("moves that change nothing answer with the same transition, so a pan allocates nothing", () => {
    const panning = replay([down("viewport"), moved]).state
    const first = transitionPreviewZoom(panning, moved)

    expect(first.state).toBe(panning)
    expect(transitionPreviewZoom(panning, moved)).toBe(first)
    expect(transitionPreviewZoom(panning, { type: "follow", zoomed: true })).toBe(first)
  })

  test("disposal releases the pan and stops the glide, then ignores everything", () => {
    const busy: PreviewZoomState = {
      status: "gliding",
      gesture: { type: "panning", pointerId: 1, target: "video", onBackdrop: false, moved: false },
    }
    const disposed = transitionPreviewZoom(busy, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "pointer.release", target: "video", pointerId: 1 },
      { type: "glide.loop.stop" },
    ])
    expect(transitionPreviewZoom(disposed.state, { type: "glide.start" }).effects).toEqual([])
  })
})
