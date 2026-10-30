export * as SharedCache from "./shared-cache.js"

import { Cause, Clock, Context, Duration, Effect, Exit, Fiber, FiberSet, Layer, Schedule } from "effect"
import { HttpClientError } from "effect/http"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/** How often the built-in provider plugins refresh their shared lists. */
export const interval = Duration.minutes(10)

export interface Input<A, E> {
  /** Everything that changes the answer, such as the connection and base URL. Never a raw secret: see `fingerprint`. */
  readonly key: string
  readonly load: Effect.Effect<A, E>
  readonly maxAge: Duration.Input
  /** Accepts only a result whose load started at or after this time, such as the time of an account switch. */
  readonly since?: number
}

export interface Interface {
  /**
   * Returns the last result for `key` while it is fresh, otherwise joins the running load or starts one. Loads never
   * overlap per key. A load retries `transient` failures 3 times. A transient failure keeps the last good value; any
   * other failure replaces it. Either is kept until `maxAge` passes, so a failing key loads at most once per
   * `maxAge`. Interrupts and defects are never kept.
   */
  readonly get: <A, E>(input: Input<A, E>) => Effect.Effect<A, E>
  /** Returns the last good value for `key`, however old, without loading. */
  readonly peek: <A>(key: string) => Effect.Effect<A | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SharedCache") {}

/** A short, one-way stand-in for a secret in a cache key, so a secret changed in place loads again. */
export const fingerprint = (secret: string) => Hash.sha256(secret).slice(0, 16)

/** Network errors, timeouts and HTTP 408, 429, 500, 502, 503 or 504, as Effect's `HttpClient.retryTransient` counts them. */
export const transient = (error: unknown) =>
  Cause.isTimeoutError(error) ||
  (HttpClientError.isHttpClientError(error) &&
    (error.reason._tag === "TransportError" ||
      (error.reason._tag === "StatusCodeError" &&
        [408, 429, 500, 502, 503, 504].includes(error.reason.response.status))))

interface Entry {
  last?: { readonly exit: Exit.Exit<unknown, unknown>; readonly time: number }
  loading?: { readonly fiber: Fiber.Fiber<unknown, unknown>; readonly time: number }
  read: number
}

const unread = Duration.toMillis(Duration.hours(1))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fibers = yield* FiberSet.make<unknown, unknown>()
    const run = yield* FiberSet.runtime(fibers)()
    const entries = new Map<string, Entry>()

    const start = Effect.fnUntraced(function* (
      key: string,
      entry: Entry,
      load: Effect.Effect<unknown, unknown>,
      time: number,
    ) {
      const exit = yield* Effect.exit(
        Effect.retry(load, { schedule: Schedule.exponential("1 second"), times: 3, while: transient }),
      )
      entry.read = yield* Clock.currentTimeMillis
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* exit
      if (Exit.isFailure(exit)) yield* Effect.logWarning("failed to load shared value", { key, cause: exit.cause })
      if (Exit.isFailure(exit) && Cause.hasDies(exit.cause)) return yield* exit
      const previous = entry.last?.exit
      entry.last = {
        exit:
          Exit.isFailure(exit) && previous && Exit.isSuccess(previous) && transient(Cause.squash(exit.cause))
            ? previous
            : exit,
        time,
      }
      return yield* entry.last.exit
    })

    const get = Effect.fnUntraced(function* <A, E>(input: Input<A, E>) {
      const now = yield* Clock.currentTimeMillis
      for (const [key, item] of entries) if (!item.loading && now - item.read > unread) entries.delete(key)
      const entry = entries.get(input.key) ?? { read: now }
      entries.set(input.key, entry)
      entry.read = now
      const since = input.since ?? now - Duration.toMillis(input.maxAge) + 1
      // The key decides the value's type, so a stored or joined result under the same key has this caller's types.
      while (true) {
        if (entry.last && entry.last.time >= since) return yield* entry.last.exit as Exit.Exit<A, E>
        if (entry.loading && (input.since === undefined || entry.loading.time >= input.since))
          return yield* Fiber.join(entry.loading.fiber as Fiber.Fiber<A, E>)
        if (entry.loading) {
          yield* Fiber.await(entry.loading.fiber)
          continue
        }
        // Yield first so `entry.loading` is set before a synchronous load can finish and clear it.
        const fiber = run(
          Effect.yieldNow.pipe(
            Effect.andThen(start(input.key, entry, input.load, now)),
            Effect.ensuring(
              Effect.sync(() => {
                entry.loading = undefined
              }),
            ),
          ),
        )
        entry.loading = { fiber, time: now }
      }
    })

    const peek = Effect.fnUntraced(function* <A>(key: string) {
      const entry = entries.get(key)
      if (!entry?.last || Exit.isFailure(entry.last.exit)) return undefined
      entry.read = yield* Clock.currentTimeMillis
      return entry.last.exit.value as A
    })

    return Service.of({ get, peek })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
