/** How long a still of a covered embed may take before the native view hides over the box background instead. */
export const SNAPSHOT_CAPTURE_TIMEOUT_MS = 5_000

/** How long a decoded still waits for Element Timing to report its frame before the native view hides anyway. */
export const SNAPSHOT_PAINT_TIMEOUT_MS = 300

/** How long the still stays under the native view after the cover ends, until the view has painted again. */
export const SNAPSHOT_THAW_DELAY_MS = 150

/**
 * A still of the embed that stands in for the native view while floating content or a dialog covers the box. The
 * native view always paints above the DOM, so it hides only once a frame has presented the still.
 */
export type EmbedSnapshotState =
  | { readonly status: "live"; readonly issued: number }
  | { readonly status: "capturing"; readonly issued: number; readonly attempt: number; readonly id: string }
  /** The still is in the DOM; the native view stays up until a frame presents it. */
  | {
      readonly status: "painting"
      readonly issued: number
      readonly attempt: number
      readonly id: string
      readonly url: string
    }
  /** The native view is hidden under the cover. */
  | {
      readonly status: "frozen"
      readonly issued: number
      readonly id: string
      /** Undefined when the capture failed, could not decode or timed out; the box shows its background. */
      readonly url: string | undefined
    }
  /** The cover ended; the still stays under the native view until it has painted again. */
  | {
      readonly status: "thawing"
      readonly issued: number
      readonly attempt: number
      readonly id: string
      readonly url: string
    }
  | { readonly status: "disposed" }

export type EmbedSnapshotEvent =
  | {
      readonly type: "sync"
      readonly id: string | undefined
      /** The plugin shows the box. */
      readonly visible: boolean
      /** The native view may show: the box is visible, the document is visible and no panel moves. */
      readonly shown: boolean
      readonly covered: boolean
    }
  /** `url` is undefined when the capture failed or did not decode. */
  | { readonly type: "capture.settled"; readonly attempt: number; readonly url: string | undefined }
  | { readonly type: "capture.timeout"; readonly attempt: number }
  | { readonly type: "snapshot.painted"; readonly url: string }
  | { readonly type: "paint.timeout"; readonly attempt: number }
  | { readonly type: "thaw.settled"; readonly attempt: number }
  | { readonly type: "disposed" }

export type EmbedSnapshotEffect =
  | { readonly type: "capture"; readonly attempt: number; readonly id: string }
  | { readonly type: "capture-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "capture-timer.stop" }
  | { readonly type: "paint-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "paint-timer.stop" }
  | { readonly type: "thaw-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "thaw-timer.stop" }
  | { readonly type: "url.revoke"; readonly url: string }
  /** Measure again, so the native view's visibility follows the new state. */
  | { readonly type: "layout.schedule" }

export type EmbedSnapshotTransition = {
  readonly state: EmbedSnapshotState
  readonly effects: readonly EmbedSnapshotEffect[]
}

type ActiveSnapshot = Exclude<EmbedSnapshotState, { readonly status: "live" | "disposed" }>

export const INITIAL_SNAPSHOT_STATE: EmbedSnapshotState = Object.freeze({ status: "live", issued: 0 })

export const DISPOSED_SNAPSHOT_STATE: EmbedSnapshotState = Object.freeze({ status: "disposed" })

const EMPTY_EFFECTS: readonly EmbedSnapshotEffect[] = Object.freeze([])

const LAYOUT: readonly EmbedSnapshotEffect[] = Object.freeze([{ type: "layout.schedule" }])

export function transitionEmbedSnapshot(state: EmbedSnapshotState, event: EmbedSnapshotEvent): EmbedSnapshotTransition {
  // A capture that settles after its attempt ended still owns its URL.
  if (event.type === "capture.settled" && (state.status !== "capturing" || state.attempt !== event.attempt))
    return event.url ? { state, effects: [{ type: "url.revoke", url: event.url }] } : unchanged(state)

  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED_SNAPSHOT_STATE, effects: release(state) }

  if (event.type === "sync") return sync(state, event)

  if (event.type === "capture.settled" && state.status === "capturing") {
    if (!event.url) return frozen(state, undefined, [{ type: "capture-timer.stop" }, { type: "layout.schedule" }])

    return {
      state: { status: "painting", issued: state.issued, attempt: state.attempt, id: state.id, url: event.url },
      effects: [
        { type: "capture-timer.stop" },
        { type: "paint-timer.start", attempt: state.attempt, delayMs: SNAPSHOT_PAINT_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "capture.timeout" && state.status === "capturing" && state.attempt === event.attempt)
    return frozen(state, undefined, LAYOUT)

  if (event.type === "snapshot.painted" && state.status === "painting" && state.url === event.url)
    return frozen(state, state.url, [{ type: "paint-timer.stop" }, { type: "layout.schedule" }])

  if (event.type === "paint.timeout" && state.status === "painting" && state.attempt === event.attempt)
    return frozen(state, state.url, LAYOUT)

  if (event.type === "thaw.settled" && state.status === "thawing" && state.attempt === event.attempt)
    return { state: { status: "live", issued: state.issued }, effects: [{ type: "url.revoke", url: state.url }] }

  return unchanged(state)
}

/** The still the box shows for `id`, or undefined. */
export function selectSnapshotUrl(state: EmbedSnapshotState, id: string | undefined, visible: boolean) {
  if (!visible || id === undefined) return undefined

  if (state.status !== "painting" && state.status !== "frozen" && state.status !== "thawing") return undefined

  return state.id === id ? state.url : undefined
}

/** Whether the native view of `id` hides under the cover, because a frame has presented its still. */
export function selectSnapshotHidesNative(state: EmbedSnapshotState, id: string | undefined, covered: boolean) {
  return covered && id !== undefined && state.status === "frozen" && state.id === id
}

/** The still Element Timing should report, or undefined when none waits for its frame. */
export function selectPaintingUrl(state: EmbedSnapshotState) {
  return state.status === "painting" ? state.url : undefined
}

/**
 * Whether a `sync` with these inputs changes the state. Measuring runs every frame of a transition or a drag, so the
 * driver builds the event only when it does.
 */
export function selectSnapshotNeedsSync(
  state: EmbedSnapshotState,
  id: string | undefined,
  visible: boolean,
  shown: boolean,
  covered: boolean,
) {
  return syncStep(state, id, visible, shown, covered) !== "keep"
}

type SyncStep = "keep" | "capture" | "release" | "thaw" | "refreeze"

function syncStep(
  state: EmbedSnapshotState,
  id: string | undefined,
  visible: boolean,
  shown: boolean,
  covered: boolean,
): SyncStep {
  if (state.status === "disposed") return "keep"

  if (state.status === "live") return id && visible && shown && covered ? "capture" : "keep"

  if (!id || !visible) return "release"

  // Another embed took the box: the previous one's still is never shown again.
  if (id !== state.id) return shown && covered ? "capture" : "release"

  if (state.status === "capturing" || state.status === "painting") return covered ? "keep" : "release"

  if (state.status === "frozen") {
    if (covered) return "keep"

    return shown && state.url !== undefined ? "thaw" : "release"
  }

  if (covered) return "refreeze"

  return shown ? "keep" : "release"
}

function sync(
  state: Exclude<EmbedSnapshotState, { readonly status: "disposed" }>,
  event: Extract<EmbedSnapshotEvent, { readonly type: "sync" }>,
): EmbedSnapshotTransition {
  const step = syncStep(state, event.id, event.visible, event.shown, event.covered)

  if (step === "keep") return unchanged(state)

  if (step === "capture" && event.id) {
    const attempt = state.issued + 1

    return {
      state: { status: "capturing", issued: attempt, attempt, id: event.id },
      effects: [
        ...release(state),
        { type: "capture", attempt, id: event.id },
        { type: "capture-timer.start", attempt, delayMs: SNAPSHOT_CAPTURE_TIMEOUT_MS },
      ],
    }
  }

  if (step === "thaw" && state.status === "frozen" && state.url !== undefined) {
    const attempt = state.issued + 1

    return {
      state: { status: "thawing", issued: attempt, attempt, id: state.id, url: state.url },
      effects: [{ type: "thaw-timer.start", attempt, delayMs: SNAPSHOT_THAW_DELAY_MS }],
    }
  }

  if (step === "refreeze" && state.status === "thawing") return frozen(state, state.url, [{ type: "thaw-timer.stop" }])

  return { state: { status: "live", issued: state.issued }, effects: release(state) }
}

// Stops the active phase's timer and gives up its still.
function release(state: EmbedSnapshotState): readonly EmbedSnapshotEffect[] {
  if (state.status === "capturing") return [{ type: "capture-timer.stop" }]

  if (state.status === "painting") return [{ type: "paint-timer.stop" }, { type: "url.revoke", url: state.url }]

  if (state.status === "frozen") return state.url ? [{ type: "url.revoke", url: state.url }] : EMPTY_EFFECTS

  if (state.status === "thawing") return [{ type: "thaw-timer.stop" }, { type: "url.revoke", url: state.url }]

  return EMPTY_EFFECTS
}

function frozen(
  state: ActiveSnapshot,
  url: string | undefined,
  effects: readonly EmbedSnapshotEffect[],
): EmbedSnapshotTransition {
  return { state: { status: "frozen", issued: state.issued, id: state.id, url }, effects }
}

function unchanged(state: EmbedSnapshotState): EmbedSnapshotTransition {
  return { state, effects: EMPTY_EFFECTS }
}
