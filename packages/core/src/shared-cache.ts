export * as SharedCache from "./shared-cache.js"

import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Equal,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect"
import { HttpClientError } from "effect/http"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "./kv.js"

/** How long a result stays fresh, and how often callers refresh, unless a caller passes its own. */
export const interval = Duration.minutes(10)

export interface Input<A, E> {
  /** Everything that changes the answer, such as the connection and base URL. Never a raw secret: see `fingerprint`. */
  readonly key: string
  readonly load: Effect.Effect<A, E>
  /** How long a result stays fresh. Defaults to `interval`; a caller refreshing on a timer uses the same value. */
  readonly interval?: Duration.Input
  /** How long a failure stays when there is no good value to return instead. Defaults to `interval`. */
  readonly failureInterval?: Duration.Input
  /** Skips the age check, but still joins a running load. */
  readonly force?: boolean
  /**
   * Saves the last good value on disk, so an entry not in memory, in this process or a later one, starts from it.
   * A saved value is stale: an infinite `interval` returns it at once, any other loads first and falls back to it.
   */
  readonly persist?: Schema.Codec<A, Schema.Json>
}

export interface Lookup<A, E> {
  /** The last good value, from memory or disk. */
  readonly value: Option.Option<A>
  /** Why the latest load failed, until one succeeds. */
  readonly failure: Option.Option<E>
}

export interface Interface {
  /**
   * Returns the last result for `key` while it is fresh, otherwise joins the running load or starts one, so loads
   * never overlap per key. A load retries `transient` failures 3 times. A failure keeps the last good value, or
   * without one is returned, until the next interval. Interrupts and defects are never kept. Entries nobody asked
   * for in 24 hours, or in two of their intervals if longer, are dropped.
   */
  readonly get: <A, E>(input: Input<A, E>) => Effect.Effect<A, E>
  /** Like `get`, but returns the last good value together with the latest failure instead of hiding either. */
  readonly lookup: <A, E>(input: Input<A, E>) => Effect.Effect<Lookup<A, E>>
  /** Drops the entries whose key starts with `prefix`, from memory and disk. */
  readonly forget: (prefix: string) => Effect.Effect<void>
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
  value: Option.Option<unknown>
  failure?: Cause.Cause<unknown>
  /** When the latest load started. */
  time?: number
  loading?: Fiber.Fiber<void, unknown>
  read: number
  unread: number
}

const unread = Duration.toMillis(Duration.hours(24))
const savedKey = (key: string) => `shared-cache:${key}`
// Wrapped, because the store cannot hold a bare `null`.
const saved = <A>(codec: Schema.Codec<A, Schema.Json>) => Schema.Struct({ value: codec })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const run = yield* FiberSet.makeRuntime<never, void, unknown>()
    const entries = new Map<string, Entry>()

    const start = Effect.fnUntraced(function* (input: Input<unknown, unknown>, entry: Entry) {
      const time = yield* Clock.currentTimeMillis
      const exit = yield* Effect.exit(
        Effect.retry(input.load, { schedule: Schedule.exponential("1 second"), times: 3, while: transient }),
      )
      entry.read = yield* Clock.currentTimeMillis
      if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* exit
      if (Exit.isFailure(exit))
        yield* Effect.logWarning("failed to load shared value", { key: input.key, cause: exit.cause })
      if (Exit.isFailure(exit) && Cause.hasDies(exit.cause)) return yield* exit
      entry.time = time
      entry.failure = Exit.isFailure(exit) ? exit.cause : undefined
      if (Exit.isFailure(exit)) return
      const changed = Option.isNone(entry.value) || !Equal.equals(entry.value.value, exit.value)
      entry.value = Option.some(exit.value)
      if (input.persist && changed)
        yield* Schema.encodeEffect(saved(input.persist))({ value: exit.value }).pipe(
          Effect.flatMap((json) => kv.set(savedKey(input.key), json)),
          Effect.catch((cause) => Effect.logWarning("failed to save shared value", { key: input.key, cause })),
        )
    })

    const read = Effect.fnUntraced(function* <A, E>(input: Input<A, E>) {
      const now = yield* Clock.currentTimeMillis
      const fresh = Duration.toMillis(input.interval ?? interval)
      for (const [key, item] of entries) if (!item.loading && now - item.read > item.unread) entries.delete(key)
      const restored =
        input.persist && !entries.has(input.key)
          ? Option.map(
              Schema.decodeUnknownOption(saved(input.persist))(yield* kv.get(savedKey(input.key))),
              (item) => item.value,
            )
          : Option.none()
      const entry = entries.get(input.key) ?? {
        value: restored,
        // Older than any finite interval, so only an infinite one returns it without loading.
        time: Option.isSome(restored) ? Number.MIN_SAFE_INTEGER : undefined,
        read: now,
        unread,
      }
      entries.set(input.key, entry)
      entry.read = now
      // A caller refreshing less often than daily must never find its entry dropped between two of its refreshes.
      if (Number.isFinite(fresh)) entry.unread = Math.max(entry.unread, 2 * fresh)
      const age = Option.isSome(entry.value) ? fresh : Duration.toMillis(input.failureInterval ?? fresh)
      if (!input.force && entry.time !== undefined && now - entry.time < age) return entry
      // Yield first so `entry.loading` is set before a synchronous load can finish and clear it.
      entry.loading ??= run(
        Effect.yieldNow.pipe(
          Effect.andThen(start(input, entry)),
          Effect.ensuring(
            Effect.sync(() => {
              entry.loading = undefined
            }),
          ),
        ),
      )
      // Only interrupts and defects reach the caller; a failure is on the entry.
      yield* Fiber.join(entry.loading).pipe(Effect.orDie)
      return entry
    })

    // The key decides the value's type, so a stored or joined result under the same key has this caller's types.
    const get = <A, E>(input: Input<A, E>) =>
      read(input).pipe(
        Effect.flatMap((entry) =>
          Option.isSome(entry.value)
            ? Effect.succeed(entry.value.value as A)
            : Effect.failCause(entry.failure as Cause.Cause<E>),
        ),
      )

    const lookup = <A, E>(input: Input<A, E>) =>
      read(input).pipe(
        Effect.map((entry) => ({
          value: entry.value as Option.Option<A>,
          failure: entry.failure ? Cause.findErrorOption(entry.failure as Cause.Cause<E>) : Option.none<E>(),
        })),
      )

    const forget = (prefix: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
        const page = yield* kv.scan({ prefix: savedKey(prefix), limit: 1000 })
        yield* Effect.forEach(page.entries, (item) => kv.remove(item.key), { discard: true })
        if (page.next) yield* forget(prefix)
      })

    return Service.of({ get, lookup, forget })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
