import { Cause, Effect, Exit, Stream } from "effect"
import { LLMError, TransportReason } from "../schema"

/**
 * Default maximum gap between stream elements before a provider stream is
 * declared stalled. Tracking starts only after the stream has begun
 * delivering elements; silence before the first element is not bounded.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000

/**
 * Event tags that end a continuous generation segment. Silence that follows
 * one of these is LOCAL or TRANSITION time, not provider stall: local tool
 * execution (bash, subagents, MCP calls, permission gates) happens between
 * `tool-call` and its `tool-result`/`tool-error`, and the next step's
 * request starts after `step-finish`. The deadline stays disarmed until the
 * next element arrives so legitimate waits are never killed.
 *
 * Trade-off: a provider hanging immediately after one of these events is not
 * bounded by this guard on paths without transport-level byte coverage (the
 * AI SDK runtime); the native route keeps byte-level protection in
 * HttpTransport.
 */
const DISARM_TAGS: ReadonlySet<string> = new Set(["tool-call", "tool-result", "tool-error", "step-finish"])

const disarmsDeadline = (element: unknown): boolean => {
  // pulls yield chunks; a boundary tag anywhere in the chunk ends the segment
  const items: readonly unknown[] = Array.isArray(element) ? element : [element]
  return items.some((item) => {
    if (typeof item !== "object" || item === null) return false
    const tag = (item as { readonly type?: unknown }).type
    return typeof tag === "string" && DISARM_TAGS.has(tag)
  })
}

const stalled = (ms: number) =>
  new LLMError({
    module: "IdleWatchdog",
    method: "guard",
    reason: new TransportReason({
      message: `Provider stream stalled: no data received for ${ms}ms`,
      kind: "IdleTimeout",
    }),
  })

const endsWithDone = <A, E>(exit: Exit.Exit<A, E>): boolean =>
  Exit.isFailure(exit) && exit.cause.reasons.some((reason) => Cause.DoneTypeId in reason)

/**
 * Fail a stream instead of letting it hang once streaming has started but
 * elements stop arriving.
 *
 * A deadline arms only after the first element and only between consecutive
 * generation elements: prompt-processing silence before the stream begins,
 * local tool execution windows, and step transitions are never counted. Any
 * other later gap is bounded by `idleMs`. This mirrors `Stream.timeoutOrElse`
 * per-pull deadlines (the bare `Stream.timeout` would END the stream
 * silently, making a stalled provider look like clean completion) while
 * skipping the phases where silence is expected.
 *
 * Any element resets the deadline, so liveness signals at ANY layer (bytes,
 * keep-alive frames) keep the stream alive when this guard wraps a low-level
 * stream.
 */
export function guardIdle(options: { readonly idleMs: number }) {
  return <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E | LLMError, R> =>
    Stream.transformPull(self, (pull) => {
      // Created once per stream execution: concurrent or repeated runs never
      // share this phase flag.
      let armed = false
      const guardedPull = Effect.gen(function* () {
        while (true) {
          const outcome = yield* (armed
            ? Effect.race(
                Effect.map(Effect.exit(pull), (exit) => ({ _tag: "data" as const, exit })),
                Effect.as(Effect.sleep(options.idleMs), { _tag: "stalled" as const }),
              )
            : Effect.map(Effect.exit(pull), (exit) => ({ _tag: "data" as const, exit }) as const))
          if (outcome._tag === "stalled") return yield* stalled(options.idleMs)
          if (Exit.isFailure(outcome.exit)) {
            if (endsWithDone(outcome.exit)) return yield* Cause.done()
            return yield* Effect.failCause(outcome.exit.cause)
          }
          const value = outcome.exit.value
          armed = !disarmsDeadline(value)
          return value
        }
      })
      return Effect.succeed(guardedPull)
    })
}

export * as IdleWatchdog from "./idle-watchdog"
