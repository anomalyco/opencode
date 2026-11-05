/** The element a pan captures the pointer on: the preview's body for an image, the borrowed video for a video. */
export type PanTarget = "viewport" | "video"

/**
 * The press under way. A `backdrop-press` began on the backdrop around the image and stayed put, so the click that ends
 * it closes the preview. A pan captures the pointer, so its click lands on the backdrop wherever it began: `onBackdrop`
 * says whether it began there, and `moved` whether it has moved, so the click that ends a moved pan neither closes the
 * preview nor plays the video.
 */
export type PreviewZoomGesture =
  | { readonly type: "idle" }
  | { readonly type: "backdrop-press" }
  | {
      readonly type: "panning"
      readonly pointerId: number
      readonly target: PanTarget
      readonly onBackdrop: boolean
      readonly moved: boolean
    }

/**
 * `gliding` is an eased zoom under way on the frame loop. Scale and offsets live on springs in the driver, not here: a
 * frame of a glide or a pan writes no state. A press does not stop a glide, so a third click of a double-click zoom
 * leaves it running; the hand moving does.
 */
export type PreviewZoomState =
  | { readonly status: "still" | "gliding"; readonly gesture: PreviewZoomGesture }
  | { readonly status: "disposed" }

/** `zoomed` is whether the image shows above fit once the event's change applies. */
export type PreviewZoomEvent =
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly button: number
      /** `content` is anywhere in the preview but its body, such as the band around it or the controls. */
      readonly target: PanTarget | "content"
      readonly onBackdrop: boolean
      readonly zoomed: boolean
    }
  | { readonly type: "pointer.moved"; readonly pointerId: number }
  | { readonly type: "pointer.up"; readonly pointerId: number }
  /** `pointercancel`, `lostpointercapture`, or a move with the primary button already up: the pan ends unreleased. */
  | { readonly type: "pointer.cancel"; readonly pointerId: number }
  | { readonly type: "backdrop.click"; readonly onBackdrop: boolean }
  /** Pinch, wheel, drag or a resize set the view directly. */
  | { readonly type: "follow"; readonly zoomed: boolean }
  | { readonly type: "glide.start" }
  | { readonly type: "glide.settled"; readonly zoomed: boolean }
  | { readonly type: "disposed" }

export type PreviewZoomEffect =
  | { readonly type: "pointer.capture"; readonly target: PanTarget; readonly pointerId: number }
  | { readonly type: "pointer.release"; readonly target: PanTarget; readonly pointerId: number }
  | { readonly type: "glide.loop.start" }
  | { readonly type: "glide.loop.stop" }
  /** Swallows the click that ends a moved pan over the video, so it does not play or pause it. */
  | { readonly type: "video.suppress-click" }
  | { readonly type: "dialog.close" }

export type PreviewZoomTransition = {
  readonly state: PreviewZoomState
  readonly effects: readonly PreviewZoomEffect[]
}

const IDLE: PreviewZoomGesture = Object.freeze({ type: "idle" })
const BACKDROP_PRESS: PreviewZoomGesture = Object.freeze({ type: "backdrop-press" })
const NONE: readonly PreviewZoomEffect[] = Object.freeze([])

export const INITIAL_PREVIEW_ZOOM_STATE: PreviewZoomState = Object.freeze({ status: "still", gesture: IDLE })

const DISPOSED: PreviewZoomState = Object.freeze({ status: "disposed" })

export function transitionPreviewZoom(state: PreviewZoomState, event: PreviewZoomEvent): PreviewZoomTransition {
  if (state.status === "disposed") return unchanged(state)
  const gliding = state.status === "gliding"
  const pan = state.gesture.type === "panning" ? state.gesture : undefined

  if (event.type === "disposed") {
    return { state: DISPOSED, effects: [...release(pan), ...(gliding ? [{ type: "glide.loop.stop" } as const] : [])] }
  }

  if (event.type === "pointer.down") {
    // A second pointer leaves the pan alone; the same pointer pressing again means its release never arrived.
    if (pan && pan.pointerId !== event.pointerId) return unchanged(state)

    if (event.button === 0 && event.zoomed && event.target !== "content") {
      return {
        state: {
          status: state.status,
          gesture: {
            type: "panning",
            pointerId: event.pointerId,
            target: event.target,
            onBackdrop: event.onBackdrop,
            moved: false,
          },
        },
        effects: [{ type: "pointer.capture", target: event.target, pointerId: event.pointerId }],
      }
    }

    return gesture(state, event.button === 0 && event.onBackdrop ? BACKDROP_PRESS : IDLE)
  }

  if (event.type === "pointer.moved") {
    if (pan?.pointerId !== event.pointerId || pan.moved) return unchanged(state)

    return gesture(state, { ...pan, onBackdrop: false, moved: true })
  }

  if (event.type === "pointer.up") {
    if (pan?.pointerId !== event.pointerId) return unchanged(state)

    if (pan.moved && pan.target === "video") {
      return { state: { status: state.status, gesture: IDLE }, effects: [{ type: "video.suppress-click" }] }
    }

    return gesture(state, !pan.moved && pan.onBackdrop ? BACKDROP_PRESS : IDLE)
  }

  if (event.type === "pointer.cancel") {
    if (pan?.pointerId !== event.pointerId) return unchanged(state)

    return { state: { status: state.status, gesture: IDLE }, effects: release(pan) }
  }

  if (event.type === "backdrop.click") {
    if (state.gesture.type !== "backdrop-press") return unchanged(state)

    return { state: { status: state.status, gesture: IDLE }, effects: event.onBackdrop ? [{ type: "dialog.close" }] : NONE }
  }

  // An eased zoom takes over from a pan, so a pan never outlives a zoom back to fit.
  if (event.type === "glide.start") {
    if (gliding && !pan) return unchanged(state)

    return {
      state: { status: "gliding", gesture: pan ? IDLE : state.gesture },
      effects: [...release(pan), ...(gliding ? [] : [{ type: "glide.loop.start" } as const])],
    }
  }

  if (event.type === "glide.settled" && !gliding) return unchanged(state)
  // The hand takes over from an eased zoom; a pan ends once the image is back at fit.
  const ends = pan && !event.zoomed ? pan : undefined

  if (!gliding && !ends) return unchanged(state)

  return {
    state: { status: "still", gesture: ends ? IDLE : state.gesture },
    effects: [...(gliding ? [{ type: "glide.loop.stop" } as const] : []), ...release(ends)],
  }
}

/** Whether a pan holds the pointer, which shows the grabbing cursor. */
export function selectDragging(state: PreviewZoomState) {
  return state.status !== "disposed" && state.gesture.type === "panning"
}

/** Whether `pointerId` is the pointer the pan under way follows. */
export function selectPanPointer(state: PreviewZoomState, pointerId: number) {
  return state.status !== "disposed" && state.gesture.type === "panning" && state.gesture.pointerId === pointerId
}

function gesture(state: Exclude<PreviewZoomState, { status: "disposed" }>, next: PreviewZoomGesture) {
  if (state.gesture === next) return unchanged(state)

  return { state: { status: state.status, gesture: next }, effects: NONE }
}

function release(pan: Extract<PreviewZoomGesture, { type: "panning" }> | undefined): readonly PreviewZoomEffect[] {
  if (!pan) return NONE

  return [{ type: "pointer.release", target: pan.target, pointerId: pan.pointerId }]
}

// Every pointer move of a pan dispatches events that change nothing; answering them with the transition already built
// for that state keeps the hot path allocation-free.
let last: PreviewZoomTransition = Object.freeze({ state: DISPOSED, effects: NONE })

function unchanged(state: PreviewZoomState) {
  if (last.state !== state) last = Object.freeze({ state, effects: NONE })

  return last
}
