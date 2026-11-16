export * as SharedCache from "./shared-cache.js"

import { Cause, Clock, Context, Duration, Effect, Exit, Fiber, FiberSet, Layer, Schedule } from "effect"
import { HttpClientError } from "effect/http"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/** How long a result stays fresh, and how often callers refresh, unless a caller passes its own. */
export const interval = Duration.minutes(10)

export interface Input<A, E> {
  /** Everything that changes the answer, such as the connection and base URL. Never a raw secret: see `fingerprint`. */
  readonly key: string
  readonly load: Effect.Effect<A, E>
  /** How long a result stays fresh. Defaults to `interval`; a caller refreshing on a timer uses the same value. */
  readonly interval?: Duration.Input
  /** Skips the age check, but still joins a running load. */
  readonly force?: boolean
}

export interface Interface {
  /**
   * Returns the last result for `key` while it is fresh, otherwise joins the running load or starts one, so loads
   * never overlap per key. A load retries `transient` failures 3 times. A failure keeps the last good value, or
   * without one is returned, until the next interval. Interrupts and defects are never kept. Entries nobody asked
   * for in 24 hours, or in two of their intervals if longer, are dropped.
   */
  readonly get: <A, E>(input: Input<A, E>) => Effect.Effect<A, E>
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
  loading?: Fiber.Fiber<unknown, unknown>
  read: number
  unread: number
}

const unread = Duration.toMillis(Duration.hours(24))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntime<never, unknown, unknown>()
    const entries = new Map<string, Entry>()

    const start = Effect.fnUntraced(function* (key: string, entry: Entry, load: Effect.Effect<unknown, unknown>) {
      const time = yield* Clock.currentTimeMillis
      const exit = yield* Effect.exit(
        Effect.retry(load, { schedule: Schedule.exponential("1 second"), times: 3, while: transient }),
      )
      entry.read = yield* Clock.currentTimeMillis
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* exit
      if (Exit.isFailure(exit)) yield* Effect.logWarning("failed to load shared value", { key, cause: exit.cause })
      if (Exit.isFailure(exit) && Cause.hasDies(exit.cause)) return yield* exit
      const previous = entry.last?.exit
      entry.last = { exit: Exit.isFailure(exit) && previous && Exit.isSuccess(previous) ? previous : exit, time }
      return yield* entry.last.exit
    })

    const get = Effect.fnUntraced(function* <A, E>(input: Input<A, E>) {
      const now = yield* Clock.currentTimeMillis
      const age = Duration.toMillis(input.interval ?? interval)
      for (const [key, item] of entries) if (!item.loading && now - item.read > item.unread) entries.delete(key)
      const entry = entries.get(input.key) ?? { read: now, unread }
      entries.set(input.key, entry)
      entry.read = now
      // A caller refreshing less often than daily must never find its entry dropped between two of its refreshes.
      if (Number.isFinite(age)) entry.unread = Math.max(entry.unread, 2 * age)
      const last = entry.last
      // The key decides the value's type, so a stored or joined result under the same key has this caller's types.
      if (!input.force && last && now - last.time < age) return yield* last.exit as Exit.Exit<A, E>
      // Yield first so `entry.loading` is set before a synchronous load can finish and clear it.
      entry.loading ??= run(
        Effect.yieldNow.pipe(
          Effect.andThen(start(input.key, entry, input.load)),
          Effect.ensuring(
            Effect.sync(() => {
              entry.loading = undefined
            }),
          ),
        ),
      )
      return yield* Fiber.join(entry.loading as Fiber.Fiber<A, E>)
    })

    return Service.of({ get })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
