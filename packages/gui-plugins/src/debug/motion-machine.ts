/** From this width the list and the open feature sit side by side. */
export const MOTION_WIDE_AT = 560

/** How long Focus frames its target. */
export const MOTION_FOCUS_MS = 1_600

/** Narrow, the list and one feature's page form a stack; wide, the selected feature sits beside the list. */
export type MotionNav = { readonly kind: "list" } | { readonly kind: "feature"; readonly key: string }

/** What a held pointer moves: the header drags the panel, the left edge resizes it. */
export type MotionHandle = "header" | "edge"

export type MotionGesture =
  | { readonly kind: "idle" }
  | { readonly kind: "held"; readonly handle: MotionHandle; readonly pointerId: number }

/**
 * The frame around the part of the app a feature changes. A hovered row frames its target until the pointer leaves;
 * Focus frames it for `MOTION_FOCUS_MS`, and only a newer hover or Focus replaces it.
 */
export type MotionOutline =
  | { readonly kind: "none" }
  | { readonly kind: "hover"; readonly target: string }
  | { readonly kind: "focus"; readonly target: string; readonly attempt: number }

export type MotionState =
  | {
      readonly status: "open"
      readonly wide: boolean
      /** The feature last opened, which the wide layout shows; kept across reloads. */
      readonly selected: string | undefined
      readonly nav: MotionNav
      readonly gesture: MotionGesture
      readonly outline: MotionOutline
      readonly issued: number
    }
  | { readonly status: "disposed" }

export type MotionEvent =
  | { readonly type: "feature.opened"; readonly key: string }
  | { readonly type: "back" }
  | { readonly type: "escape" }
  /** The registry changed; `present` says whether the pushed feature is still registered. */
  | { readonly type: "features.changed"; readonly present: boolean }
  | { readonly type: "resized"; readonly wide: boolean }
  | {
      readonly type: "pointer.down"
      readonly handle: MotionHandle
      readonly pointerId: number
      readonly button: number
    }
  /** The handle lost its pointer capture: released, cancelled, or taken away. */
  | { readonly type: "pointer.released"; readonly pointerId: number }
  | { readonly type: "row.entered"; readonly target: string | undefined }
  | { readonly type: "row.left" }
  | { readonly type: "target.focused"; readonly target: string }
  | { readonly type: "outline.expired"; readonly attempt: number }
  | { readonly type: "disposed" }

export type MotionEffect =
  | { readonly type: "save" }
  | { readonly type: "close" }
  /** Moves focus into the pushed page, shown now rather than on the spring's next frame. */
  | { readonly type: "focus.page" }
  | { readonly type: "focus.row"; readonly key: string }
  /** The pushed page went away: focus the list if focus was in the page. */
  | { readonly type: "focus.list" }
  /** Clamps the panel into the window and saves where it ended. */
  | { readonly type: "settle" }
  | { readonly type: "outline.frame"; readonly target: string | undefined }
  | { readonly type: "outline.focus"; readonly target: string; readonly attempt: number; readonly delay: number }
  | { readonly type: "outline.dispose" }

export type MotionTransition = { readonly state: MotionState; readonly effects: readonly MotionEffect[] }

type Open = Extract<MotionState, { status: "open" }>

type OpenTransition = { readonly state: Open; readonly effects: readonly MotionEffect[] }

export function createMotionState(input: {
  readonly wide: boolean
  readonly selected: string | undefined
}): MotionState {
  return {
    status: "open",
    wide: input.wide,
    selected: input.selected,
    nav: { kind: "list" },
    gesture: { kind: "idle" },
    outline: { kind: "none" },
    issued: 0,
  }
}

export function transitionMotion(state: MotionState, event: MotionEvent): MotionTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "outline.dispose" }] }

  if (event.type === "feature.opened") {
    // A pushed page makes the list inert before the pointer leaves its row, so the hover outline clears here. Wide,
    // nothing is pushed, so narrowing later lands on the list.
    const cleared = clearOutline(state)
    const nav: MotionNav = state.wide ? { kind: "list" } : { kind: "feature", key: event.key }

    return {
      state: { ...cleared.state, selected: event.key, nav },
      effects: [...cleared.effects, { type: "save" }, ...(state.wide ? [] : [{ type: "focus.page" as const }])],
    }
  }

  if (event.type === "back") return pop(state)

  if (event.type === "escape") {
    if (!state.wide && state.nav.kind === "feature") return pop(state)

    return { state, effects: [{ type: "close" }] }
  }

  if (event.type === "features.changed") {
    if (state.nav.kind !== "feature" || event.present) return { state, effects: [] }

    return { state: { ...state, nav: { kind: "list" } }, effects: [{ type: "focus.list" }] }
  }

  if (event.type === "resized") return { state: resized(state, event.wide), effects: [] }

  // The driver captures the pointer once the machine holds it, and only then reads where the gesture starts.
  if (event.type === "pointer.down") {
    if (event.button !== 0 || state.gesture.kind !== "idle") return { state, effects: [] }

    return {
      state: { ...state, gesture: { kind: "held", handle: event.handle, pointerId: event.pointerId } },
      effects: [],
    }
  }

  if (event.type === "pointer.released") {
    if (state.gesture.kind !== "held" || state.gesture.pointerId !== event.pointerId) return { state, effects: [] }

    return { state: { ...state, gesture: { kind: "idle" } }, effects: [{ type: "settle" }] }
  }

  if (event.type === "row.entered") {
    if (!event.target) return clearOutline(state)

    if (state.outline.kind === "hover" && state.outline.target === event.target) return { state, effects: [] }

    return {
      state: { ...state, outline: { kind: "hover", target: event.target } },
      effects: [{ type: "outline.frame", target: event.target }],
    }
  }

  // Leaving a row clears only its hover frame, never a Focus frame still showing.
  if (event.type === "row.left") return state.outline.kind === "hover" ? clearOutline(state) : { state, effects: [] }

  if (event.type === "target.focused") {
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, outline: { kind: "focus", target: event.target, attempt } },
      effects: [{ type: "outline.focus", target: event.target, attempt, delay: MOTION_FOCUS_MS }],
    }
  }

  if (state.outline.kind !== "focus" || state.outline.attempt !== event.attempt) return { state, effects: [] }

  return clearOutline(state)
}

/** Whether the narrow stack shows the pushed page; the list is inert meanwhile. */
export function selectMotionPushed(state: MotionState) {
  return state.status === "open" && !state.wide && state.nav.kind === "feature"
}

export function selectMotionWide(state: MotionState) {
  return state.status === "open" && state.wide
}

/**
 * The feature the page shows: the selected one, or wide the first. Narrow, it stays while the page slides back out.
 */
export function selectMotionFeature<Feature extends { readonly key: string }>(
  state: MotionState,
  features: readonly Feature[],
) {
  if (state.status !== "open") return

  return features.find((item) => item.key === state.selected) ?? (state.wide ? features[0] : undefined)
}

/** The pointer a handle holds, so its moves drag or resize; every other pointer is ignored. */
export function selectMotionHeld(state: MotionState, handle: MotionHandle, pointerId: number) {
  return (
    state.status === "open" &&
    state.gesture.kind === "held" &&
    state.gesture.handle === handle &&
    state.gesture.pointerId === pointerId
  )
}

/** No handle is held, so a size change settles the panel at once. */
export function selectMotionIdle(state: MotionState) {
  return state.status === "open" && state.gesture.kind === "idle"
}

export function selectMotionSelected(state: MotionState) {
  return state.status === "open" ? state.selected : undefined
}

// Widening shows the selected feature beside the list, so narrowing again lands on the list.
function resized(state: Open, wide: boolean): Open {
  if (state.wide === wide) return state

  return { ...state, wide, nav: wide ? { kind: "list" } : state.nav }
}

function pop(state: Open): MotionTransition {
  if (state.nav.kind !== "feature") return { state, effects: [] }

  return { state: { ...state, nav: { kind: "list" } }, effects: [{ type: "focus.row", key: state.nav.key }] }
}

function clearOutline(state: Open): OpenTransition {
  if (state.outline.kind === "none") return { state, effects: [] }

  return { state: { ...state, outline: { kind: "none" } }, effects: [{ type: "outline.frame", target: undefined }] }
}
