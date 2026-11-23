/** How far the panel may move from its home while staying inside the window. */
export type PanelBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export type MutablePanelBounds = { -readonly [K in keyof PanelBounds]: PanelBounds[K] }

export type VoicePanelState =
  /** The saved position has not loaded; nothing may move or write it yet. */
  | { readonly status: "hydrating" }
  | { readonly status: "idle"; readonly x: number; readonly y: number }
  /**
   * Bounds and `x`/`y` change in place on `pointer.move` and `resize`, so a drag allocates nothing and writes no
   * signal until it ends. Hold this state in a signal or variable, never a Solid store.
   */
  | {
      readonly status: "dragging"
      readonly pointerId: number
      /** The pointer's offset from the panel's position. */
      readonly startX: number
      readonly startY: number
      minX: number
      maxX: number
      minY: number
      maxY: number
      x: number
      y: number
    }
  | { readonly status: "disposed" }

export type VoicePanelEvent =
  | { readonly type: "hydrated"; readonly x: number; readonly y: number; readonly bounds: PanelBounds }
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly clientX: number
      readonly clientY: number
      readonly bounds: PanelBounds
    }
  /** Mutable so the driver reuses one object for every move. */
  | { type: "pointer.move"; pointerId: number; clientX: number; clientY: number }
  /** `pointerup`, `pointercancel` or `lostpointercapture`. */
  | { readonly type: "pointer.up"; readonly pointerId: number }
  | { readonly type: "blur" }
  | { readonly type: "resize"; readonly bounds: PanelBounds }
  | { readonly type: "disposed" }

export const HYDRATING_VOICE_PANEL_STATE: VoicePanelState = Object.freeze({ status: "hydrating" })

const DISPOSED: VoicePanelState = Object.freeze({ status: "disposed" })

const ORIGIN = Object.freeze({ x: 0, y: 0 })

export function transitionVoicePanel(state: VoicePanelState, event: VoicePanelEvent): VoicePanelState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED

  if (state.status === "hydrating") {
    if (event.type !== "hydrated") return state

    return idle(
      state,
      axis(event.x, event.bounds.minX, event.bounds.maxX),
      axis(event.y, event.bounds.minY, event.bounds.maxY),
    )
  }

  if (state.status === "idle") {
    if (event.type === "resize")
      return idle(
        state,
        axis(state.x, event.bounds.minX, event.bounds.maxX),
        axis(state.y, event.bounds.minY, event.bounds.maxY),
      )

    if (event.type !== "pointer.down") return state

    return {
      status: "dragging",
      pointerId: event.pointerId,
      startX: event.clientX - state.x,
      startY: event.clientY - state.y,
      minX: event.bounds.minX,
      maxX: event.bounds.maxX,
      minY: event.bounds.minY,
      maxY: event.bounds.maxY,
      x: state.x,
      y: state.y,
    }
  }

  if (event.type === "pointer.move") {
    if (event.pointerId !== state.pointerId) return state
    state.x = axis(event.clientX - state.startX, state.minX, state.maxX)
    state.y = axis(event.clientY - state.startY, state.minY, state.maxY)

    return state
  }

  // The panel grew or the window shrank mid-drag: later moves clamp to the new bounds.
  if (event.type === "resize") {
    state.minX = event.bounds.minX
    state.maxX = event.bounds.maxX
    state.minY = event.bounds.minY
    state.maxY = event.bounds.maxY
    state.x = axis(state.x, state.minX, state.maxX)
    state.y = axis(state.y, state.minY, state.maxY)

    return state
  }

  if ((event.type === "pointer.up" && event.pointerId === state.pointerId) || event.type === "blur")
    return { status: "idle", x: state.x, y: state.y }

  return state
}

/** The offset painted on the panel now. */
export function voicePanelOffset(state: VoicePanelState): { readonly x: number; readonly y: number } {
  return state.status === "idle" || state.status === "dragging" ? state : ORIGIN
}

export function voicePanelTransform(state: VoicePanelState) {
  const offset = voicePanelOffset(state)

  return `translate(${offset.x}px, ${offset.y}px)`
}

/** A press drags only once the saved position loaded, and only one pointer at a time. */
export function canGrabVoicePanel(state: VoicePanelState) {
  return state.status === "idle"
}

/** Captions share the saved record, so they toggle only once it loaded. */
export function canToggleVoiceCaptions(state: VoicePanelState) {
  return state.status === "idle" || state.status === "dragging"
}

/** Fills `out` with the panel's bounds from its rect, measured while `rendered` was the painted offset. */
export function fillVoicePanelBounds(
  out: MutablePanelBounds,
  rect: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  rendered: { readonly x: number; readonly y: number },
  width: number,
  height: number,
) {
  out.minX = rendered.x - rect.left
  out.maxX = rendered.x + width - rect.right
  out.minY = rendered.y - rect.top
  out.maxY = rendered.y + height - rect.bottom

  return out
}

function idle(state: VoicePanelState, x: number, y: number): VoicePanelState {
  if (state.status === "idle" && state.x === x && state.y === y) return state

  return { status: "idle", x, y }
}

function axis(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
