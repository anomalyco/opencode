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
  /** Skips the age check, but still joins a running load. */
  readonly force?: boolean
}

export interface Interface {
  /**
   * Returns the last result for `key` while it is fresh, otherwise joins the running load or starts one, so loads
   * never overlap per key. A load retries `transient` failures 3 times. A failure keeps the last good value for
   * `maxAge`; without one, the failure is kept for 30 seconds. Interrupts and defects are never kept.
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
}

const failureAge = Duration.toMillis(Duration.seconds(30))
const unread = Duration.toMillis(Duration.hours(1))

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
      for (const [key, item] of entries) if (!item.loading && now - item.read > unread) entries.delete(key)
      const entry = entries.get(input.key) ?? { read: now }
      entries.set(input.key, entry)
      entry.read = now
      const last = entry.last
      const age = last && Exit.isSuccess(last.exit) ? Duration.toMillis(input.maxAge) : failureAge
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
