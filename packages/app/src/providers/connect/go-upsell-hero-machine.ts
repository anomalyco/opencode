/** The longest step one frame may advance the art, so a stalled tab resumes where it paused instead of skipping. */
export const HERO_MAX_DT_MS = 100

/**
 * Lifecycle of the Go upsell hero canvas. Kept in a plain variable, never a Solid store: `frame` advances `time`
 * and `last` in place and returns the same object, so the animation loop allocates nothing per frame.
 */
export type HeroLoopState =
  /** The rAF loop draws art time `time`; `last` is the previous frame's timestamp. */
  | { readonly status: "running"; readonly attempt: number; time: number; last: number }
  /** The page is hidden: nothing draws and art time stands still. */
  | { readonly status: "paused"; readonly attempt: number; readonly time: number }
  /** Reduced motion: one still frame, redrawn only when its size, pixel ratio or theme changes. */
  | { readonly status: "still"; readonly attempt: number; readonly time: number }
  | { readonly status: "disposed" }

export type HeroLoopEvent =
  | { readonly type: "synced"; readonly reduced: boolean; readonly hidden: boolean; readonly now: number }
  /** Reused by the driver for every frame. */
  | { readonly type: "frame"; attempt: number; now: number }
  | { readonly type: "disposed" }

const DISPOSED: HeroLoopState = Object.freeze({ status: "disposed" })

export function createHeroLoopState(input: { reduced: boolean; hidden: boolean; now: number }): HeroLoopState {
  return enter({ attempt: 1, time: 0 }, input)
}

export function transitionHeroLoop(state: HeroLoopState, event: HeroLoopEvent): HeroLoopState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED

  if (event.type === "frame") {
    if (state.status !== "running" || event.attempt !== state.attempt) return state
    // The first frame's vsync timestamp can precede the `performance.now()` read when the loop started.
    state.time += Math.max(0, Math.min(HERO_MAX_DT_MS, event.now - state.last))
    state.last = event.now

    return state
  }

  if (status(event) === state.status) return state

  return enter({ attempt: state.attempt + 1, time: state.time }, event)
}

/** Whether a size, pixel ratio or theme change must repaint now; a running loop picks it up on its next frame. */
export function selectHeroRedrawsStill(state: HeroLoopState) {
  return state.status === "still"
}

function status(input: { reduced: boolean; hidden: boolean }) {
  if (input.hidden) return "paused"

  return input.reduced ? "still" : "running"
}

function enter(
  base: { attempt: number; time: number },
  input: { reduced: boolean; hidden: boolean; now: number },
): HeroLoopState {
  const next = status(input)

  if (next === "running") return { status: next, attempt: base.attempt, time: base.time, last: input.now }

  return { status: next, attempt: base.attempt, time: base.time }
}
