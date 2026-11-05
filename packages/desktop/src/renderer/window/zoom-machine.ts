import type { DesktopZoomLevel } from "@opencode/app/desktop-menu"

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2
const WHEEL_PINCH_THRESHOLD = 20
const WHEEL_PINCH_STEP = 0.2

export const WHEEL_PINCH_END_DELAY = 160

export type ZoomReply = {
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

// Whether a Ctrl+wheel gesture zooms the page. `updating` keeps the previous value to restore if main refuses it.
export type PinchSetting =
  | { readonly status: "unseeded" }
  | { readonly status: "settled"; readonly enabled: boolean }
  | { readonly status: "updating"; readonly attempt: number; readonly enabled: boolean; readonly previous: boolean }

// The zoom this renderer asked main for and has not seen land yet.
export type ZoomRequest =
  | { readonly kind: "factor"; readonly attempt: number; readonly target: number }
  | { readonly kind: "level"; readonly attempt: number; readonly target: DesktopZoomLevel }

// `factorSeeded` and `levelSeeded` turn true on the first answer, user action or main event, so a late boot read
// cannot overwrite a newer value.
type ZoomBase = {
  readonly factor: number
  readonly factorSeeded: boolean
  readonly level: DesktopZoomLevel
  readonly levelSeeded: boolean
  readonly pinch: PinchSetting
  readonly nextAttempt: number
  readonly request: ZoomRequest | undefined
}

// The wheel gesture: `accumulating` until the deltas cross the threshold, then `pinching` from the zoom at that point.
export type ZoomState =
  | (ZoomBase & { readonly status: "idle" })
  | (ZoomBase & { readonly status: "accumulating"; readonly totalDelta: number })
  | (ZoomBase & { readonly status: "pinching"; readonly startZoom: number; readonly totalDelta: number })

export type ZoomEvent =
  | { readonly type: "factor.seeded"; readonly factor: number }
  | { readonly type: "factor.seed-failed" }
  | { readonly type: "level.seeded"; readonly level: DesktopZoomLevel }
  | { readonly type: "level.seed-failed" }
  | { readonly type: "pinch.seeded"; readonly enabled: boolean }
  | { readonly type: "pinch.changed"; readonly enabled: boolean }
  | { readonly type: "pinch.requested"; readonly enabled: boolean; readonly reply: ZoomReply }
  | { readonly type: "pinch.succeeded"; readonly attempt: number }
  | { readonly type: "pinch.failed"; readonly attempt: number }
  | { readonly type: "zoom.changed"; readonly factor: number; readonly level: DesktopZoomLevel }
  | { readonly type: "level.requested"; readonly level: DesktopZoomLevel; readonly reply: ZoomReply }
  | { readonly type: "level.succeeded"; readonly attempt: number }
  | { readonly type: "level.failed"; readonly attempt: number }
  | { readonly type: "factor.succeeded"; readonly attempt: number }
  | { readonly type: "factor.failed"; readonly attempt: number }
  // `delta` is writable so the wheel listener reuses one event object across frames.
  | { readonly type: "wheel.pinched"; delta: number }
  | { readonly type: "pinch.ended" }

export type ZoomEffect =
  | { readonly type: "sync-wheel-listener"; readonly enabled: boolean }
  | { readonly type: "arm-pinch-timer" }
  | { readonly type: "cancel-pinch-timer" }
  | { readonly type: "set-zoom-factor"; readonly attempt: number; readonly factor: number }
  | {
      readonly type: "set-zoom-level"
      readonly attempt: number
      readonly level: DesktopZoomLevel
      readonly reply: ZoomReply
    }
  | { readonly type: "set-pinch-zoom"; readonly attempt: number; readonly enabled: boolean; readonly reply: ZoomReply }

export type ZoomTransition = {
  readonly state: ZoomState
  readonly effects: readonly ZoomEffect[]
}

type IdleZoom = Extract<ZoomState, { status: "idle" }>

export function createZoomState(): ZoomState {
  return {
    status: "idle",
    factor: 1,
    factorSeeded: false,
    level: 1,
    levelSeeded: false,
    pinch: { status: "unseeded" },
    nextAttempt: 1,
    request: undefined,
  }
}

export function transitionZoom(state: ZoomState, event: ZoomEvent): ZoomTransition {
  switch (event.type) {
    case "wheel.pinched":
      return wheel(state, event.delta)

    case "pinch.ended":
      if (state.status === "idle") return unchanged(state)

      return { state: idle(state), effects: CANCEL_TIMER }

    case "factor.seeded":
      if (state.factorSeeded) return unchanged(state)

      return { state: { ...state, factor: clampZoom(event.factor), factorSeeded: true }, effects: NO_EFFECTS }

    case "factor.seed-failed":
      if (state.factorSeeded) return unchanged(state)

      return { state: { ...state, factorSeeded: true }, effects: NO_EFFECTS }

    case "level.seeded":
      if (state.levelSeeded) return unchanged(state)

      return { state: { ...state, level: event.level, levelSeeded: true }, effects: NO_EFFECTS }

    case "level.seed-failed":
      if (state.levelSeeded) return unchanged(state)

      return { state: { ...state, levelSeeded: true }, effects: NO_EFFECTS }

    case "pinch.seeded":
      if (state.pinch.status !== "unseeded") return unchanged(state)

      return {
        state: { ...state, pinch: { status: "settled", enabled: event.enabled } },
        effects: event.enabled ? [{ type: "sync-wheel-listener", enabled: true }] : NO_EFFECTS,
      }

    case "pinch.changed":
      return setPinch(state, { status: "settled", enabled: event.enabled }, NO_EFFECTS)

    case "pinch.requested": {
      const attempt = state.nextAttempt

      return setPinch(
        { ...state, nextAttempt: attempt + 1 },
        { status: "updating", attempt, enabled: event.enabled, previous: selectPinchEnabled(state) },
        [{ type: "set-pinch-zoom", attempt, enabled: event.enabled, reply: event.reply }],
      )
    }

    case "pinch.succeeded":
      if (state.pinch.status !== "updating" || state.pinch.attempt !== event.attempt) return unchanged(state)

      return { state: { ...state, pinch: { status: "settled", enabled: state.pinch.enabled } }, effects: NO_EFFECTS }

    case "pinch.failed":
      if (state.pinch.status !== "updating" || state.pinch.attempt !== event.attempt) return unchanged(state)

      return setPinch(state, { status: "settled", enabled: state.pinch.previous }, NO_EFFECTS)

    case "zoom.changed": {
      // Main reports each level it applies; a newer level this renderer asked for may still be on its way.
      const pending = state.request?.kind === "level" && state.request.target !== event.level
      const next: IdleZoom = {
        ...idle(state),
        factor: clampZoom(event.factor),
        factorSeeded: true,
        level: event.level,
        levelSeeded: true,
        request: pending ? state.request : undefined,
      }

      return { state: next, effects: state.status === "idle" ? NO_EFFECTS : CANCEL_TIMER }
    }

    case "level.requested": {
      const attempt = state.nextAttempt
      const effect: ZoomEffect = { type: "set-zoom-level", attempt, level: event.level, reply: event.reply }
      const next: IdleZoom = {
        ...idle(state),
        factorSeeded: true,
        levelSeeded: true,
        nextAttempt: attempt + 1,
        request: { kind: "level", attempt, target: event.level },
      }

      return { state: next, effects: state.status === "idle" ? [effect] : [CANCEL_PINCH_TIMER, effect] }
    }

    case "level.succeeded":
      if (state.request?.kind !== "level" || state.request.attempt !== event.attempt) return unchanged(state)

      return {
        state: { ...state, factor: state.request.target, level: state.request.target, request: undefined },
        effects: NO_EFFECTS,
      }

    case "level.failed":
      if (state.request?.kind !== "level" || state.request.attempt !== event.attempt) return unchanged(state)

      return { state: { ...state, request: undefined }, effects: NO_EFFECTS }

    case "factor.succeeded":
      if (state.request?.kind !== "factor" || state.request.attempt !== event.attempt) return unchanged(state)

      return { state: { ...state, factor: state.request.target, request: undefined }, effects: NO_EFFECTS }

    case "factor.failed":
      if (state.request?.kind !== "factor" || state.request.attempt !== event.attempt) return unchanged(state)

      return { state: { ...state, request: undefined }, effects: NO_EFFECTS }
  }
}

/** The zoom the window shows, as main last confirmed it. */
export function selectWebviewZoom(state: ZoomState) {
  return state.factor
}

export function selectZoomLevel(state: ZoomState) {
  return state.level
}

/** The zoom the next step starts from: the pending request's target, else the confirmed zoom. */
export function selectRequestedZoom(state: ZoomState) {
  return state.request?.target ?? state.factor
}

export function selectPinchEnabled(state: ZoomState) {
  return state.pinch.status !== "unseeded" && state.pinch.enabled
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
}

// Frozen effect lists keep wheel frames free of allocations beyond the next state.
const NO_EFFECTS: readonly ZoomEffect[] = Object.freeze([])
const ARM_PINCH_TIMER: ZoomEffect = Object.freeze({ type: "arm-pinch-timer" })
const CANCEL_PINCH_TIMER: ZoomEffect = Object.freeze({ type: "cancel-pinch-timer" })
const ARM_TIMER: readonly ZoomEffect[] = Object.freeze([ARM_PINCH_TIMER])
const CANCEL_TIMER: readonly ZoomEffect[] = Object.freeze([CANCEL_PINCH_TIMER])

function wheel(state: ZoomState, delta: number): ZoomTransition {
  if (!selectPinchEnabled(state)) return unchanged(state)

  if (state.status === "idle") {
    if (Math.abs(delta) < WHEEL_PINCH_THRESHOLD)
      return { state: { ...state, status: "accumulating", totalDelta: delta }, effects: ARM_TIMER }

    return {
      state: { ...state, status: "pinching", startZoom: selectRequestedZoom(state), totalDelta: 0 },
      effects: ARM_TIMER,
    }
  }

  if (delta === 0) return { state, effects: ARM_TIMER }
  const totalDelta = state.totalDelta + delta

  if (state.status === "accumulating") {
    if (Math.abs(totalDelta) < WHEEL_PINCH_THRESHOLD) return { state: { ...state, totalDelta }, effects: ARM_TIMER }

    // The gesture starts from the zoom at the moment it crossed the threshold.
    return {
      state: { ...state, status: "pinching", startZoom: selectRequestedZoom(state), totalDelta: 0 },
      effects: ARM_TIMER,
    }
  }

  const target = clampZoom(state.startZoom - (totalDelta / WHEEL_PINCH_THRESHOLD) * WHEEL_PINCH_STEP)

  if (target === selectRequestedZoom(state)) return { state: { ...state, totalDelta }, effects: ARM_TIMER }
  const attempt = state.nextAttempt

  return {
    state: {
      ...state,
      totalDelta,
      factorSeeded: true,
      nextAttempt: attempt + 1,
      request: { kind: "factor", attempt, target },
    },
    effects: [ARM_PINCH_TIMER, { type: "set-zoom-factor", attempt, factor: target }],
  }
}

// Turning pinch zoom off ends a gesture; the wheel listener follows the effective setting.
function setPinch(state: ZoomState, setting: PinchSetting, after: readonly ZoomEffect[]): ZoomTransition {
  const before = selectPinchEnabled(state)
  const next: ZoomState = { ...state, pinch: setting }
  const enabled = selectPinchEnabled(next)
  const ends = !enabled && next.status !== "idle"

  return {
    state: ends ? idle(next) : next,
    effects: [
      ...(ends ? CANCEL_TIMER : NO_EFFECTS),
      ...(before === enabled ? NO_EFFECTS : [{ type: "sync-wheel-listener" as const, enabled }]),
      ...after,
    ],
  }
}

function idle(state: ZoomState): IdleZoom {
  if (state.status === "idle") return state

  return {
    status: "idle",
    factor: state.factor,
    factorSeeded: state.factorSeeded,
    level: state.level,
    levelSeeded: state.levelSeeded,
    pinch: state.pinch,
    nextAttempt: state.nextAttempt,
    request: state.request,
  }
}

function unchanged(state: ZoomState): ZoomTransition {
  return { state, effects: NO_EFFECTS }
}
