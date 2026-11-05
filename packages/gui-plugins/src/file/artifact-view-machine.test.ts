import { describe, expect, test } from "bun:test"
import type { FileContent } from "@opencode/plugin/gui"
import {
  createArtifactViewerState,
  createVideoOverlayState,
  INITIAL_IMAGE_STAGE_GESTURE_STATE,
  selectArtifactInfo,
  selectArtifactMode,
  selectArtifactPreviewable,
  selectArtifactReason,
  selectArtifactShowingPreview,
  selectArtifactStageKind,
  selectStageClickSuppressed,
  selectStageCursor,
  selectVideoControlsVisible,
  selectVideoLoading,
  transitionArtifactViewer,
  transitionImageStageGesture,
  transitionVideoOverlay,
  type ArtifactViewerEvent,
  type ArtifactViewerState,
  type ImageStageGestureEvent,
  type ImageStageGestureState,
  type ImageStageGestureTransition,
  type VideoOverlayEvent,
  type VideoOverlayState,
  type VideoOverlayTransition,
} from "./artifact-view-machine"

const svg = (content: string): FileContent => ({ type: "text", content })

describe("artifact viewer", () => {
  const run = (state: ArtifactViewerState, content: FileContent, ...events: ArtifactViewerEvent[]) =>
    events.reduce((value, event) => transitionArtifactViewer(value, content, event), state)

  test("a broken SVG keeps its source action and can still show its source", () => {
    // Before: a failed decode turned the kind into binary, which removed "View source" for a text file.
    const content = svg("<svg")
    const failed = run(createArtifactViewerState(content), content, {
      type: "decode.failed",
      content,
      reason: "Failed to load",
    })

    expect(selectArtifactStageKind(failed, "broken.svg", content)).toBe("binary")
    expect(selectArtifactPreviewable("broken.svg", content)).toBe(true)
    expect(selectArtifactReason(failed, content)).toBe("Failed to load")

    const source = run(failed, content, { type: "mode.changed", mode: "source" })
    expect(selectArtifactMode(source, content)).toBe("source")
    expect(selectArtifactShowingPreview(source, "broken.svg", content)).toBe(false)

    const back = run(source, content, { type: "mode.changed", mode: "preview" })
    expect(selectArtifactShowingPreview(back, "broken.svg", content)).toBe(true)
    expect(selectArtifactReason(back, content)).toBe("Failed to load")
    expect(selectArtifactInfo(back, content)).toEqual({})
  })

  test("a failure drops reported facts, and facts after a failure change nothing", () => {
    const content = svg("<svg/>")
    const reported = run(createArtifactViewerState(content), content, {
      type: "info.reported",
      content,
      info: { width: 2, height: 3 },
    })

    expect(selectArtifactInfo(reported, content)).toEqual({ width: 2, height: 3 })
    const failed = run(reported, content, { type: "decode.failed", content })
    expect(selectArtifactInfo(failed, content)).toEqual({})
    expect(run(failed, content, { type: "info.reported", content, info: { width: 2 } })).toBe(failed)
    expect(run(failed, content, { type: "decode.failed", content })).toBe(failed)
  })

  test("binary files offer no source", () => {
    const content: FileContent = { type: "binary", content: "AAEC", encoding: "base64" }

    expect(selectArtifactPreviewable("sample.bin", content)).toBe(false)
    expect(selectArtifactShowingPreview(createArtifactViewerState(content), "sample.bin", content)).toBe(true)
    expect(selectArtifactStageKind(createArtifactViewerState(content), "sample.bin", content)).toBe("binary")
  })

  test("results for an earlier content change nothing, and a reread starts from the preview", () => {
    // Before: a late failure for the previous content was stamped onto the reread one.
    const first = svg("<svg/>")
    const second = svg("<svg></svg>")
    const source = run(createArtifactViewerState(first), first, { type: "mode.changed", mode: "source" })
    const failed = run(source, first, { type: "decode.failed", content: first })

    expect(selectArtifactMode(failed, second)).toBe("preview")
    expect(selectArtifactStageKind(failed, "a.svg", second)).toBe("svg")

    const late = run(
      failed,
      second,
      { type: "decode.failed", content: first, reason: "Failed to load" },
      { type: "info.reported", content: first, info: { width: 1, height: 1 } },
    )

    expect(late.content).toBe(second)
    expect(selectArtifactStageKind(late, "a.svg", second)).toBe("svg")
    expect(selectArtifactInfo(late, second)).toEqual({})
  })
})

describe("image stage gesture", () => {
  const down = (pointerId = 1, zoomed = true): ImageStageGestureEvent => ({
    type: "pointer.down",
    pointerId,
    button: 0,
    primary: true,
    zoomed,
  })

  const run = (state: ImageStageGestureState, ...events: ImageStageGestureEvent[]) =>
    events.reduce<ImageStageGestureTransition>((step, event) => transitionImageStageGesture(step.state, event), {
      state,
      effects: [],
    })

  test("a moved pan swallows its click, even after the browser releases capture", () => {
    const released = run(
      INITIAL_IMAGE_STAGE_GESTURE_STATE,
      down(),
      { type: "pointer.moved", pointerId: 1 },
      { type: "pointer.up", pointerId: 1 },
      { type: "pointer.cancel", pointerId: 1 },
    )

    expect(selectStageClickSuppressed(released.state)).toBe(true)
    const clicked = run(released.state, { type: "click" })
    expect(clicked.state).toEqual({ status: "idle" })
    expect(selectStageClickSuppressed(clicked.state)).toBe(false)
  })

  test("a cancelled pan, or a touch pan with no click, does not swallow the next click", () => {
    // Before: the moved flag outlived a pointercancel and ate the next real click.
    const cancelled = run(
      INITIAL_IMAGE_STAGE_GESTURE_STATE,
      down(),
      { type: "pointer.moved", pointerId: 1 },
      { type: "pointer.cancel", pointerId: 1 },
    )

    expect(cancelled.effects).toEqual([{ type: "pointer.release", pointerId: 1 }])
    expect(selectStageClickSuppressed(cancelled.state)).toBe(false)

    const touched = run(
      INITIAL_IMAGE_STAGE_GESTURE_STATE,
      down(),
      { type: "pointer.moved", pointerId: 1 },
      { type: "pointer.up", pointerId: 1 },
      down(2, false),
    )

    expect(touched.state).toEqual({ status: "idle" })
  })

  test("a press that never moved leaves clicks alone", () => {
    const pressed = run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down(), { type: "pointer.up", pointerId: 1 })

    expect(selectStageClickSuppressed(pressed.state)).toBe(false)
  })

  test("zooming back to fit ends the pan and releases the pointer", () => {
    // Before: a Ctrl+wheel zoom out or Fit mid-drag left the drag active at fit.
    const panning = run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down())
    const fitted = run(panning.state, { type: "zoom.changed", zoomed: false })

    expect(fitted.state).toEqual({ status: "idle" })
    expect(fitted.effects).toEqual([{ type: "pointer.release", pointerId: 1 }])
    expect(selectStageCursor(panning.state, true)).toBe("grabbing")
    expect(selectStageCursor(fitted.state, true)).toBe("grab")
    expect(run(panning.state, { type: "zoom.changed", zoomed: true }).state).toBe(panning.state)
  })

  test("only a primary press on a zoomed image pans, and a second pointer leaves it alone", () => {
    expect(run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down(1, false)).state).toBe(INITIAL_IMAGE_STAGE_GESTURE_STATE)
    const panning = run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down())

    expect(panning.effects).toEqual([{ type: "pointer.capture", pointerId: 1 }])
    expect(run(panning.state, down(2)).state).toBe(panning.state)
    expect(run(panning.state, { type: "pointer.up", pointerId: 2 }).state).toBe(panning.state)
  })

  test("pointer moves after the threshold allocate nothing", () => {
    const moved = run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down(), { type: "pointer.moved", pointerId: 1 })
    const event: ImageStageGestureEvent = { type: "pointer.moved", pointerId: 1 }
    const first = transitionImageStageGesture(moved.state, event)

    expect(first.state).toBe(moved.state)
    expect(transitionImageStageGesture(moved.state, event)).toBe(first)
  })

  test("disposal releases a pan and ignores everything after", () => {
    const disposed = run(INITIAL_IMAGE_STAGE_GESTURE_STATE, down(), { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "pointer.release", pointerId: 1 }])
    expect(run(disposed.state, down()).state).toBe(disposed.state)
  })
})

describe("video overlay", () => {
  const run = (state: VideoOverlayState, ...events: VideoOverlayEvent[]) =>
    events.reduce<VideoOverlayTransition>((step, event) => transitionVideoOverlay(step.state, event), {
      state,
      effects: [],
    })

  const paused = run(createVideoOverlayState(), { type: "media.loaded", paused: true }).state

  test("loading hides the controls until the first frame", () => {
    expect(selectVideoLoading(createVideoOverlayState())).toBe(true)
    expect(selectVideoControlsVisible(createVideoOverlayState())).toBe(false)
    expect(selectVideoLoading(paused)).toBe(false)
    expect(selectVideoControlsVisible(paused)).toBe(true)
  })

  test("playing starts a fresh idle timer, so a timer armed while paused cannot hide the controls", () => {
    // Before: a pointer move while paused armed a timer that hid the controls shortly after Play.
    const moved = transitionVideoOverlay(paused, { type: "pointer.moved" })
    expect(moved.state).toBe(paused)
    expect(moved.effects).toEqual([])

    const playing = run(paused, { type: "playback.changed", paused: false })
    expect(playing.effects).toEqual([{ type: "idle.schedule", attempt: 1, delayMs: 2_500 }])
    expect(selectVideoControlsVisible(playing.state)).toBe(true)
    expect(run(playing.state, { type: "idle.elapsed", attempt: 0 }).state).toBe(playing.state)

    const idle = run(playing.state, { type: "idle.elapsed", attempt: 1 })
    expect(selectVideoControlsVisible(idle.state)).toBe(false)
    expect(run(idle.state, { type: "pointer.moved" }).effects).toEqual([
      { type: "idle.schedule", attempt: 2, delayMs: 2_500 },
    ])
  })

  test("pausing or leaving clears the idle timer", () => {
    const playing = run(paused, { type: "playback.changed", paused: false }).state

    expect(run(playing, { type: "playback.changed", paused: true }).effects).toEqual([{ type: "idle.clear" }])
    const left = run(playing, { type: "pointer.left" })
    expect(left.effects).toEqual([{ type: "idle.clear" }])
    expect(selectVideoControlsVisible(left.state)).toBe(false)
  })

  test("the controls stay hidden while the preview flies the video back", () => {
    // Before: closing the preview showed the fullscreen button at once, over a stage the video had not returned to.
    const expanded = run(paused, { type: "expand.requested", canExpand: true })
    expect(expanded.effects).toEqual([{ type: "preview.open", attempt: 1 }])
    expect(selectVideoControlsVisible(expanded.state)).toBe(false)
    expect(run(expanded.state, { type: "expand.requested", canExpand: true }).state).toBe(expanded.state)
    expect(run(expanded.state, { type: "pointer.moved" }).state).toBe(expanded.state)

    const playing = run(expanded.state, { type: "playback.changed", paused: false })
    expect(selectVideoControlsVisible(playing.state)).toBe(false)
    expect(run(playing.state, { type: "preview.returned", attempt: 0 }).state).toBe(playing.state)

    const back = run(playing.state, { type: "preview.returned", attempt: 1 })
    expect(back.state).toEqual({ status: "playing-idle", issued: 1 })
    expect(back.effects).toEqual([{ type: "preview.release", attempt: 1 }])
    expect(run(back.state, { type: "preview.returned", attempt: 1 }).state).toBe(back.state)
  })

  test("a video without a frame, or still loading, does not expand", () => {
    expect(run(paused, { type: "expand.requested", canExpand: false }).state).toBe(paused)
    const loading = createVideoOverlayState()
    expect(run(loading, { type: "expand.requested", canExpand: true }).state).toBe(loading)
  })

  test("unmounting closes an open preview and clears a running timer", () => {
    // Before: a closed tab left its preview dialog open with no owner.
    const expanded = run(paused, { type: "expand.requested", canExpand: true }).state

    expect(run(expanded, { type: "disposed" }).effects).toEqual([{ type: "preview.close", attempt: 1 }])
    const playing = run(paused, { type: "playback.changed", paused: false }).state
    const disposed = run(playing, { type: "disposed" })
    expect(disposed.effects).toEqual([{ type: "idle.clear" }])
    expect(run(disposed.state, { type: "idle.elapsed", attempt: 1 }).state).toBe(disposed.state)
  })
})
