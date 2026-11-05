import type { FileContent } from "@opencode/plugin/gui"
import { artifactKind, type ArtifactKind } from "@opencode/util/artifact"

export type ArtifactMode = "preview" | "source"

/** Facts a viewer learns from the decoded media, shown in the toolbar. */
export type ArtifactInfo = {
  readonly width?: number
  readonly height?: number
  readonly duration?: number
  readonly rows?: number
  readonly columns?: number
  /** Facts a plugin's viewer reports, already localized. */
  readonly details?: readonly string[]
}

/**
 * The viewer of one loaded content: a reread file starts from the preview again. `undecodable` is a file its viewer
 * could not decode; it shows the binary placeholder in preview and keeps the mode, so a broken SVG can still show its
 * source.
 */
export type ArtifactViewerState =
  | { readonly status: "preview" | "source"; readonly content: FileContent; readonly info: ArtifactInfo }
  | {
      readonly status: "undecodable"
      readonly content: FileContent
      readonly mode: ArtifactMode
      /** Why the file shows as binary, when a viewer said. */
      readonly reason?: string
    }

/** Results name the content they decoded, so a late one from a file since reread changes nothing. */
export type ArtifactViewerEvent =
  | { readonly type: "mode.changed"; readonly mode: ArtifactMode }
  | { readonly type: "info.reported"; readonly content: FileContent; readonly info: ArtifactInfo }
  | { readonly type: "decode.failed"; readonly content: FileContent; readonly reason?: string }

const EMPTY_INFO: ArtifactInfo = Object.freeze({})

/** Kinds that render a preview from their text and can toggle back to highlighted source. */
const previewableKinds: readonly ArtifactKind[] = ["svg", "html", "markdown", "mermaid", "table"]

export function createArtifactViewerState(content: FileContent): ArtifactViewerState {
  return { status: "preview", content, info: EMPTY_INFO }
}

/** `content` is the one shown now; state kept for an earlier content reads as a fresh preview. */
export function transitionArtifactViewer(
  state: ArtifactViewerState,
  content: FileContent,
  event: ArtifactViewerEvent,
): ArtifactViewerState {
  const base = current(state, content)

  if (event.type === "mode.changed") {
    if (selectArtifactMode(base, content) === event.mode) return base

    return base.status === "undecodable" ? { ...base, mode: event.mode } : { status: event.mode, content, info: base.info }
  }

  if (event.content !== content) return base

  if (event.type === "info.reported") {
    if (base.status === "undecodable") return base

    return { status: base.status, content, info: event.info }
  }

  if (base.status === "undecodable" && base.reason === event.reason) return base

  // A file that fails also drops the facts its viewer reported, such as a page count.
  return { status: "undecodable", content, mode: selectArtifactMode(base, content), reason: event.reason }
}

/** Text of a kind that previews from it can switch to its source, also once its preview failed to decode. */
export function selectArtifactPreviewable(path: string, content: FileContent) {
  return content.type !== "binary" && previewableKinds.includes(artifactKind(path))
}

export function selectArtifactMode(state: ArtifactViewerState, content: FileContent): ArtifactMode {
  const value = current(state, content)

  return value.status === "undecodable" ? value.mode : value.status
}

export function selectArtifactShowingPreview(state: ArtifactViewerState, path: string, content: FileContent) {
  return !selectArtifactPreviewable(path, content) || selectArtifactMode(state, content) === "preview"
}

/** The viewer the stage renders; `binary` is the placeholder. */
export function selectArtifactStageKind(
  state: ArtifactViewerState,
  path: string,
  content: FileContent,
): ArtifactKind | "binary" {
  if (content.type === "binary" && !content.mimeType) return "binary"

  if (current(state, content).status === "undecodable") return "binary"

  return artifactKind(path)
}

export function selectArtifactInfo(state: ArtifactViewerState, content: FileContent) {
  const value = current(state, content)

  return value.status === "undecodable" ? EMPTY_INFO : value.info
}

export function selectArtifactReason(state: ArtifactViewerState, content: FileContent) {
  const value = current(state, content)

  return value.status === "undecodable" ? value.reason : undefined
}

function current(state: ArtifactViewerState, content: FileContent) {
  return state.content === content ? state : createArtifactViewerState(content)
}

/** How far a press moves before it pans rather than clicks. */
export const STAGE_DRAG_THRESHOLD_PX = 3

/**
 * The press on a zoomed image. `suppress-click` follows a pan that moved: the click that ends it neither fits nor
 * zooms. It lasts until that click or the next press, since a touch pan produces no click. Pan offsets live in the
 * driver and paint straight to the image, so a pointer move writes no state.
 */
export type ImageStageGestureState =
  | { readonly status: "idle" }
  | { readonly status: "panning"; readonly pointerId: number; readonly moved: boolean }
  | { readonly status: "suppress-click" }
  | { readonly status: "disposed" }

/** `zoomed` is whether the image shows above fit. */
export type ImageStageGestureEvent =
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly button: number
      readonly primary: boolean
      readonly zoomed: boolean
    }
  /** The pan pointer moved past the threshold. */
  | { readonly type: "pointer.moved"; readonly pointerId: number }
  | { readonly type: "pointer.up"; readonly pointerId: number }
  /** `pointercancel`, `lostpointercapture`, or a mouse move with the primary button already up. */
  | { readonly type: "pointer.cancel"; readonly pointerId: number }
  /** Fit, a click, a pinch or a wheel zoom changed whether the image shows above fit. */
  | { readonly type: "zoom.changed"; readonly zoomed: boolean }
  | { readonly type: "click" }
  | { readonly type: "disposed" }

export type ImageStageGestureEffect =
  | { readonly type: "pointer.capture"; readonly pointerId: number }
  | { readonly type: "pointer.release"; readonly pointerId: number }

export type ImageStageGestureTransition = {
  readonly state: ImageStageGestureState
  readonly effects: readonly ImageStageGestureEffect[]
}

const STAGE_IDLE: ImageStageGestureState = Object.freeze({ status: "idle" })

const STAGE_SUPPRESS_CLICK: ImageStageGestureState = Object.freeze({ status: "suppress-click" })

const STAGE_DISPOSED: ImageStageGestureState = Object.freeze({ status: "disposed" })

const NO_STAGE_EFFECTS: readonly ImageStageGestureEffect[] = Object.freeze([])

export const INITIAL_IMAGE_STAGE_GESTURE_STATE: ImageStageGestureState = STAGE_IDLE

export function transitionImageStageGesture(
  state: ImageStageGestureState,
  event: ImageStageGestureEvent,
): ImageStageGestureTransition {
  if (state.status === "disposed") return unchangedStage(state)
  const pan = state.status === "panning" ? state : undefined

  if (event.type === "disposed") return { state: STAGE_DISPOSED, effects: releaseStage(pan) }

  if (event.type === "pointer.down") {
    // A second pointer leaves the pan alone; the same pointer pressing again means its release never arrived.
    if (pan && pan.pointerId !== event.pointerId) return unchangedStage(state)

    if (event.primary && event.button === 0 && event.zoomed) {
      return {
        state: { status: "panning", pointerId: event.pointerId, moved: false },
        effects: [{ type: "pointer.capture", pointerId: event.pointerId }],
      }
    }

    return state.status === "suppress-click" ? unchangedStage(STAGE_IDLE) : unchangedStage(state)
  }

  if (event.type === "pointer.moved") {
    if (pan?.pointerId !== event.pointerId || pan.moved) return unchangedStage(state)

    return { state: { status: "panning", pointerId: pan.pointerId, moved: true }, effects: NO_STAGE_EFFECTS }
  }

  if (event.type === "pointer.up") {
    if (pan?.pointerId !== event.pointerId) return unchangedStage(state)

    return unchangedStage(pan.moved ? STAGE_SUPPRESS_CLICK : STAGE_IDLE)
  }

  // The browser releases capture itself after pointerup; that lostpointercapture lands in suppress-click and changes
  // nothing, so the click that follows is still swallowed.
  if (event.type === "pointer.cancel") {
    if (pan?.pointerId !== event.pointerId) return unchangedStage(state)

    return { state: STAGE_IDLE, effects: releaseStage(pan) }
  }

  if (event.type === "zoom.changed") {
    if (!pan || event.zoomed) return unchangedStage(state)

    return { state: STAGE_IDLE, effects: releaseStage(pan) }
  }

  return state.status === "suppress-click" ? unchangedStage(STAGE_IDLE) : unchangedStage(state)
}

/** Whether the pan under way follows `pointerId`. */
export function selectStagePanPointer(state: ImageStageGestureState, pointerId: number) {
  return state.status === "panning" && state.pointerId === pointerId
}

/** Whether the pan under way has passed the threshold, so each move pans. */
export function selectStagePanMoved(state: ImageStageGestureState) {
  return state.status === "panning" && state.moved
}

/** Whether the next click ends a moved pan, and so neither fits nor zooms. */
export function selectStageClickSuppressed(state: ImageStageGestureState) {
  return state.status === "suppress-click"
}

export function selectStageCursor(state: ImageStageGestureState, zoomed: boolean) {
  if (!zoomed) return undefined

  return state.status === "panning" ? "grabbing" : "grab"
}

function releaseStage(pan: Extract<ImageStageGestureState, { status: "panning" }> | undefined) {
  if (!pan) return NO_STAGE_EFFECTS

  return [{ type: "pointer.release", pointerId: pan.pointerId } as const]
}

// Every pointer move of a pan dispatches events that change nothing; answering them with the transition already built
// for that state keeps the hot path allocation-free.
let lastStage: ImageStageGestureTransition = Object.freeze({ state: STAGE_DISPOSED, effects: NO_STAGE_EFFECTS })

function unchangedStage(state: ImageStageGestureState) {
  if (lastStage.state !== state) lastStage = Object.freeze({ state, effects: NO_STAGE_EFFECTS })

  return lastStage
}

/** How long playing video keeps its overlay controls after the pointer last moved. */
export const VIDEO_IDLE_MS = 2_500

/**
 * The inline video's overlay controls. They show while paused, and while playing until the pointer rests. `expanded`
 * lasts from the preview opening until the borrowed video is back in the stage (or the preview is gone), so the
 * controls never float over an empty stage while it flies back. `issued` numbers each idle timer and preview: in
 * `playing-active` it is the running timer, in `expanded` the open preview.
 */
export type VideoOverlayState =
  | { readonly status: "loading"; readonly paused: boolean; readonly issued: number }
  | { readonly status: "paused" | "playing-active" | "playing-idle"; readonly issued: number }
  | { readonly status: "expanded"; readonly issued: number; readonly paused: boolean }
  | { readonly status: "disposed" }

export type VideoOverlayEvent =
  | { readonly type: "media.loaded"; readonly paused: boolean }
  | { readonly type: "playback.changed"; readonly paused: boolean }
  | { readonly type: "pointer.moved" }
  | { readonly type: "pointer.left" }
  | { readonly type: "idle.elapsed"; readonly attempt: number }
  /** `canExpand`: the video has a frame and sits in the stage. */
  | { readonly type: "expand.requested"; readonly canExpand: boolean }
  /** The video is back in the stage, or the preview closed or was disposed without taking it. */
  | { readonly type: "preview.returned"; readonly attempt: number }
  | { readonly type: "disposed" }

export type VideoOverlayEffect =
  | { readonly type: "idle.schedule"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "idle.clear" }
  | { readonly type: "preview.open"; readonly attempt: number }
  /** Stops watching for the video's return; the preview closes on its own. */
  | { readonly type: "preview.release"; readonly attempt: number }
  /** The stage is going away: stop watching and close the preview. */
  | { readonly type: "preview.close"; readonly attempt: number }

export type VideoOverlayTransition = {
  readonly state: VideoOverlayState
  readonly effects: readonly VideoOverlayEffect[]
}

const VIDEO_DISPOSED: VideoOverlayState = Object.freeze({ status: "disposed" })

export function createVideoOverlayState(): VideoOverlayState {
  return { status: "loading", paused: true, issued: 0 }
}

export function transitionVideoOverlay(state: VideoOverlayState, event: VideoOverlayEvent): VideoOverlayTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    if (state.status === "playing-active") return { state: VIDEO_DISPOSED, effects: [{ type: "idle.clear" }] }

    if (state.status === "expanded") {
      return { state: VIDEO_DISPOSED, effects: [{ type: "preview.close", attempt: state.issued }] }
    }

    return { state: VIDEO_DISPOSED, effects: [] }
  }

  if (event.type === "media.loaded") {
    if (state.status !== "loading") return { state, effects: [] }

    return event.paused ? { state: { status: "paused", issued: state.issued }, effects: [] } : active(state.issued)
  }

  if (event.type === "playback.changed") {
    if (state.status === "loading" || state.status === "expanded") {
      return state.paused === event.paused ? { state, effects: [] } : { state: { ...state, paused: event.paused }, effects: [] }
    }

    if (event.paused === (state.status === "paused")) return { state, effects: [] }

    if (!event.paused) return active(state.issued)

    return {
      state: { status: "paused", issued: state.issued },
      effects: state.status === "playing-active" ? [{ type: "idle.clear" }] : [],
    }
  }

  // Paused, loading or expanded video keeps its controls as they are, so pointer moves start no timers.
  if (event.type === "pointer.moved") {
    if (state.status !== "playing-active" && state.status !== "playing-idle") return { state, effects: [] }

    return active(state.issued)
  }

  if (event.type === "pointer.left") {
    if (state.status !== "playing-active") return { state, effects: [] }

    return { state: { status: "playing-idle", issued: state.issued }, effects: [{ type: "idle.clear" }] }
  }

  if (event.type === "idle.elapsed") {
    if (state.status !== "playing-active" || state.issued !== event.attempt) return { state, effects: [] }

    return { state: { status: "playing-idle", issued: state.issued }, effects: [] }
  }

  if (event.type === "expand.requested") {
    if (state.status === "loading" || state.status === "expanded" || !event.canExpand) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: { status: "expanded", issued: attempt, paused: state.status === "paused" },
      effects: [
        ...(state.status === "playing-active" ? [{ type: "idle.clear" } as const] : []),
        { type: "preview.open", attempt },
      ],
    }
  }

  if (state.status !== "expanded" || state.issued !== event.attempt) return { state, effects: [] }

  return {
    state: { status: state.paused ? "paused" : "playing-idle", issued: state.issued },
    effects: [{ type: "preview.release", attempt: state.issued }],
  }
}

/** The loading indicator holds the stage until the first frame. */
export function selectVideoLoading(state: VideoOverlayState) {
  return state.status === "loading"
}

export function selectVideoControlsVisible(state: VideoOverlayState) {
  return state.status === "paused" || state.status === "playing-active"
}

function active(issued: number): VideoOverlayTransition {
  const attempt = issued + 1

  return {
    state: { status: "playing-active", issued: attempt },
    effects: [{ type: "idle.schedule", attempt, delayMs: VIDEO_IDLE_MS }],
  }
}
