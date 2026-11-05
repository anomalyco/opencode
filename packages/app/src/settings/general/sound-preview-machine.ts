/** Moving through the sound list plays only the sound it settles on. */
export const SOUND_PREVIEW_DEBOUNCE_MS = 100

/** A sound file that never loads gives up rather than playing long after the user moved on. */
export const SOUND_PREVIEW_LOAD_TIMEOUT_MS = 5_000

export type SoundPreviewState<Stop = () => void> =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "debouncing"; readonly attempt: number; readonly id: string }
  | { readonly status: "loading"; readonly attempt: number; readonly id: string }
  | { readonly status: "playing"; readonly attempt: number; readonly id: string; readonly active: Stop }
  | { readonly status: "disposed" }

export type SoundPreviewEvent<Stop = () => void> =
  | { readonly type: "play.requested"; readonly id: string | undefined }
  | { readonly type: "stop.requested" }
  | { readonly type: "debounce.elapsed"; readonly attempt: number }
  /** `active` stops the sound; none when nothing played. */
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly active: Stop | undefined }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SoundPreviewEffect<Stop = () => void> =
  /** Replaces any running timer; dispatches `debounce.elapsed` or `load.timed-out` with `attempt`. */
  | { readonly type: "timer.start"; readonly kind: "debounce" | "load"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.stop" }
  | { readonly type: "audio.load"; readonly attempt: number; readonly id: string }
  | { readonly type: "audio.stop"; readonly active: Stop }

export type SoundPreviewTransition<Stop = () => void> = {
  readonly state: SoundPreviewState<Stop>
  readonly effects: readonly SoundPreviewEffect<Stop>[]
}

export function createSoundPreviewState<Stop = () => void>(): SoundPreviewState<Stop> {
  return { status: "idle", attempt: 0 }
}

export function transitionSoundPreview<Stop>(
  state: SoundPreviewState<Stop>,
  event: SoundPreviewEvent<Stop>,
): SoundPreviewTransition<Stop> {
  // A sound that loads after it was superseded, stopped or unmounted is stopped as it arrives.
  if (event.type === "load.succeeded" && (state.status !== "loading" || state.attempt !== event.attempt))
    return { state, effects: event.active === undefined ? [] : [{ type: "audio.stop", active: event.active }] }

  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: release(state) }

  if (event.type === "play.requested" || event.type === "stop.requested") {
    const id = event.type === "play.requested" ? event.id : undefined

    if (!id) {
      if (state.status === "idle") return { state, effects: [] }

      return { state: { status: "idle", attempt: state.attempt + 1 }, effects: release(state) }
    }

    const attempt = state.attempt + 1

    return {
      state: { status: "debouncing", attempt, id },
      effects: [
        ...(state.status === "playing" ? release(state) : []),
        { type: "timer.start", kind: "debounce", attempt, delayMs: SOUND_PREVIEW_DEBOUNCE_MS },
      ],
    }
  }

  if (event.type === "debounce.elapsed") {
    if (state.status !== "debouncing" || state.attempt !== event.attempt) return { state, effects: [] }

    return {
      state: { status: "loading", attempt: state.attempt, id: state.id },
      effects: [
        { type: "audio.load", attempt: state.attempt, id: state.id },
        { type: "timer.start", kind: "load", attempt: state.attempt, delayMs: SOUND_PREVIEW_LOAD_TIMEOUT_MS },
      ],
    }
  }

  if (state.status !== "loading" || state.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "load.succeeded" && event.active !== undefined)
    return {
      state: { status: "playing", attempt: state.attempt, id: state.id, active: event.active },
      effects: [STOP],
    }

  return { state: { status: "idle", attempt: state.attempt }, effects: [STOP] }
}

const STOP = { type: "timer.stop" } as const

/** What leaving `state` must stop: its timer or its sound. */
function release<Stop>(state: SoundPreviewState<Stop>): SoundPreviewEffect<Stop>[] {
  if (state.status === "debouncing" || state.status === "loading") return [STOP]

  if (state.status === "playing") return [{ type: "audio.stop", active: state.active }]

  return []
}
