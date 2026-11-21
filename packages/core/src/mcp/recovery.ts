export * as McpRecovery from "./recovery.js"

import { Clock, Effect, Fiber, Random } from "effect"

export interface Report {
  readonly answered?: boolean
  readonly retryable?: boolean
  /** Minimum delay requested by the server, in milliseconds. */
  readonly retryAfter?: number
}

export interface Input {
  readonly name: string
  /** The owner's runtime keeps the worker alive until the Location closes. */
  readonly fork: (effect: Effect.Effect<void>) => Fiber.Fiber<void>
  readonly attempt: Effect.Effect<void>
  /** Checked again by the attempt after acquiring its lifecycle lock. */
  readonly stale: () => boolean
}

/** One worker owns every retry; attempt events only update its next decision. */
export function make(input: Input) {
  const state: {
    worker?: { fiber?: Fiber.Fiber<void> }
    pending: boolean
    stopped: boolean
    failures: number
    retryAfter: number
    connectedAt?: number
  } = { pending: false, stopped: false, failures: 0, retryAfter: 0 }

  const start = Effect.sync(() => {
    if (state.worker || state.stopped || input.stale() || !state.pending) return
    // Reserve ownership before forking: a runtime may start the fiber synchronously.
    const worker: { fiber?: Fiber.Fiber<void> } = {}
    state.worker = worker
    worker.fiber = input.fork(
      Effect.gen(function* () {
        while (state.worker === worker && state.pending && !state.stopped && !input.stale()) {
          const jitter = 0.8 + (yield* Random.next) * 0.4
          const wait = Math.max(
            state.retryAfter,
            Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(0, state.failures - 1), 6) * jitter),
          )
          yield* Effect.logDebug("mcp recovery scheduled", { server: input.name, delayMs: wait })
          yield* Effect.sleep(wait)
          if (state.worker !== worker || !state.pending || state.stopped || input.stale()) return
          state.retryAfter = 0
          yield* input.attempt
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (state.worker === worker) state.worker = undefined
          }),
        ),
      ),
    )
  })

  const cancel = () =>
    Effect.gen(function* () {
      const worker = state.worker
      state.worker = undefined
      state.stopped = true
      state.pending = false
      state.failures = 0
      state.retryAfter = 0
      state.connectedAt = undefined
      if (worker?.fiber) yield* Fiber.interrupt(worker.fiber)
    })

  return {
    notifyFailure: (report: Report) =>
      Effect.gen(function* () {
        if (state.stopped) return
        state.pending = report.retryable === true
        state.retryAfter = report.retryAfter ?? 0
        state.connectedAt = undefined
        if (!state.pending) return
        state.failures++
        yield* start
      }),
    notifyClosed: () =>
      Effect.gen(function* () {
        if (state.stopped) return
        const now = yield* Clock.currentTimeMillis
        if (state.connectedAt !== undefined && now - state.connectedAt >= 30_000) state.failures = 0
        state.connectedAt = undefined
        state.pending = true
        state.retryAfter = 0
        state.failures++
        yield* start
      }),
    notifyConnected: () =>
      Effect.gen(function* () {
        state.connectedAt = yield* Clock.currentTimeMillis
        state.pending = false
        state.retryAfter = 0
      }),
    reset: () => cancel().pipe(Effect.andThen(Effect.sync(() => (state.stopped = false)))),
    cancel,
  }
}

export interface Recovery extends ReturnType<typeof make> {}
