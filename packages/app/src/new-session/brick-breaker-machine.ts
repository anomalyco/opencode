export const BRICK_BREAKER_LIVES = 3

// Phase lengths in seconds, shared with the animations that fill them.
export const BRICK_BREAKER_TIMING = {
  // The ball lands on the shrinking composer, which has become the paddle by `enter`.
  enterLand: 0.38,
  enter: 0.85,
  // After a miss the ball drops back onto the paddle before it can be served.
  serveDrop: 0.42,
  miss: 0.55,
  exit: 1,
} as const

export type BrickBreakerExit = "win" | "lose" | "quit"

/**
 * A brick breaker game, held in a plain variable by the frame loop and replaced whole, never in a Solid store. Each
 * timed phase counts from `startedAt`, in the frame loop's clock (seconds). `landed` marks the ball resting on the
 * paddle, which it must before it can be served.
 */
export type BrickBreakerState =
  | { readonly status: "enter"; readonly startedAt: number; readonly landed: boolean }
  | { readonly status: "serve"; readonly startedAt: number; readonly landed: boolean; readonly lives: number }
  | { readonly status: "play"; readonly lives: number }
  | { readonly status: "miss"; readonly startedAt: number; readonly lives: number }
  | { readonly status: "exit"; readonly startedAt: number; readonly kind: BrickBreakerExit }
  // The exit morph finished or the game unmounted.
  | { readonly status: "disposed" }

export type BrickBreakerEvent =
  // The frame loop reuses one event object, so `now` is writable.
  | { readonly type: "frame"; now: number }
  | { readonly type: "launch" }
  | { readonly type: "cleared"; readonly now: number }
  | { readonly type: "missed"; readonly now: number }
  | { readonly type: "quit"; readonly now: number }
  | { readonly type: "dispose" }

const DISPOSED: BrickBreakerState = Object.freeze({ status: "disposed" })

export function createBrickBreakerState(now: number): BrickBreakerState {
  return { status: "enter", startedAt: now, landed: false }
}

/** Returns the same object when no phase threshold is crossed, so the frame loop allocates nothing. */
export function transitionBrickBreaker(state: BrickBreakerState, event: BrickBreakerEvent): BrickBreakerState {
  if (state.status === "disposed") return state

  if (event.type === "dispose") return DISPOSED

  if (event.type === "quit") return state.status === "exit" ? state : exit(event.now, "quit")

  if (event.type === "launch")
    return state.status === "serve" && state.landed ? { status: "play", lives: state.lives } : state

  if (event.type === "cleared") return state.status === "play" ? exit(event.now, "win") : state

  if (event.type === "missed")
    return state.status === "play" ? { status: "miss", startedAt: event.now, lives: state.lives } : state

  if (state.status === "play") return state
  const elapsed = event.now - state.startedAt

  if (state.status === "enter") {
    if (elapsed >= BRICK_BREAKER_TIMING.enter)
      return { status: "serve", startedAt: event.now, landed: true, lives: BRICK_BREAKER_LIVES }

    return !state.landed && elapsed >= BRICK_BREAKER_TIMING.enterLand ? { ...state, landed: true } : state
  }

  if (state.status === "serve")
    return !state.landed && elapsed >= BRICK_BREAKER_TIMING.serveDrop ? { ...state, landed: true } : state

  if (state.status === "miss") {
    if (elapsed < BRICK_BREAKER_TIMING.miss) return state

    if (state.lives <= 1) return exit(event.now, "lose")

    return { status: "serve", startedAt: event.now, landed: false, lives: state.lives - 1 }
  }

  return elapsed >= BRICK_BREAKER_TIMING.exit ? DISPOSED : state
}

/** Input steers and serves until the exit morph starts. */
export function acceptsBrickBreakerInput(state: BrickBreakerState) {
  return state.status !== "exit" && state.status !== "disposed"
}

/** The paddle follows input once the composer has shrunk into it, until it grows back. */
export function movesBrickBreakerPaddle(state: BrickBreakerState) {
  return state.status === "serve" || state.status === "play" || state.status === "miss"
}

export function isBrickBreakerBallMoving(state: BrickBreakerState) {
  return state.status === "play" || state.status === "miss"
}

/** Spare lives shown beside the paddle, not counting the ball in play. */
export function brickBreakerSpares(state: BrickBreakerState) {
  if (state.status === "enter") return BRICK_BREAKER_LIVES - 1

  if (state.status === "serve" || state.status === "play" || state.status === "miss") return state.lives - 1

  return 0
}

function exit(now: number, kind: BrickBreakerExit): BrickBreakerState {
  return { status: "exit", startedAt: now, kind }
}
