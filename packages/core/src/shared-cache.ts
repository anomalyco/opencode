export * as SharedCache from "./shared-cache.js"

import {
  Cause,
  Context,
  Deferred,
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
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect"
import { HttpClientError } from "effect/http"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KV } from "./kv.js"

/** How often a source refreshes unless it passes its own `interval`. */
export const interval = Duration.minutes(10)

export interface Input<A, E> {
  /**
   * Everything that changes the answer, such as the connection and base URL. Never a raw secret: see `fingerprint`.
   * Every holder of a key shares one entry, so two sources with the same key must load the same thing.
   */
  readonly key: string
  /** Runs on every refresh. It resolves credentials itself, since tokens rotate between refreshes. */
  readonly load: Effect.Effect<A, E>
  /** How often to refresh. Defaults to `interval`; `Duration.infinity` loads once. */
  readonly interval?: Duration.Input
  /** Saves the last good value on disk, so the next source for the key, in this process or a later one, starts from it. */
  readonly persist?: Schema.Codec<A, Schema.Json>
}

export interface State<A, E> {
  /** The last good value. */
  readonly value: Option.Option<A>
  /** Why the latest refresh failed, until one succeeds. */
  readonly failure: Option.Option<E>
}

export interface Source<A, E> {
  /** The current value. Waits only for the first load when there is no value at all yet, and fails only without one. */
  readonly get: Effect.Effect<A, E>
  /** The current value and failure, without waiting. */
  readonly current: Effect.Effect<State<A, E>>
  /** The current state, then every change of the value or the failure. */
  readonly changes: Stream.Stream<State<A, E>>
}

export interface Interface {
  /**
   * Holds the source for `key` until the scope closes. The first holder starts it: it restores the saved value, if
   * any, then loads at once and every `interval` on one timer that every holder shares. A refresh retries `transient`
   * failures 3 times. A failed refresh keeps the last good value; without one it tries again within a minute, even
   * on a longer interval. When the last holder's scope closes, the timer stops and the value leaves memory.
   * Refreshes run the oldest remaining holder's `load` and `interval`.
   */
  readonly source: <A, E>(input: Input<A, E>) => Effect.Effect<Source<A, E>, never, Scope.Scope>
  /** Drops the saved values whose key starts with `prefix`, and stops refreshing their sources. */
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
  readonly holders: Input<unknown, unknown>[]
  readonly state: SubscriptionRef.SubscriptionRef<State<unknown, unknown>>
  /** Why the latest refresh failed, including defects, which `state` cannot carry. */
  cause?: Cause.Cause<unknown>
  /** Done once there is a value or the first load finished. */
  readonly ready: Deferred.Deferred<void>
  fiber?: Fiber.Fiber<void>
}

const emptyRetry = Duration.minutes(1)
const savedKey = (key: string) => `shared-cache:${key}`
// Wrapped, because the store cannot hold a bare `null`.
const saved = <A>(codec: Schema.Codec<A, Schema.Json>) => Schema.Struct({ value: codec })

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const run = yield* FiberSet.makeRuntime<never, void, never>()
    const entries = new Map<string, Entry>()
    const lock = Semaphore.makeUnsafe(1)

    const refresh = Effect.fnUntraced(function* (key: string, entry: Entry) {
      const input = entry.holders[0]
      if (!input) return
      const exit = yield* Effect.exit(
        Effect.retry(input.load, { schedule: Schedule.exponential("1 second"), times: 3, while: transient }),
      )
      const previous = yield* SubscriptionRef.get(entry.state)
      if (Exit.isFailure(exit)) {
        yield* Effect.logWarning("failed to load shared value", { key, cause: exit.cause })
        entry.cause = exit.cause
        const failure = Cause.findErrorOption(exit.cause)
        if (!sameFailure(previous.failure, failure)) yield* SubscriptionRef.set(entry.state, { ...previous, failure })
        return
      }
      entry.cause = undefined
      const changed = Option.isNone(previous.value) || !Equal.equals(previous.value.value, exit.value)
      if (changed && input.persist)
        yield* Schema.encodeEffect(saved(input.persist))({ value: exit.value }).pipe(
          Effect.flatMap((json) => kv.set(savedKey(key), json)),
          Effect.catch((cause) => Effect.logWarning("failed to save shared value", { key, cause })),
        )
      if (changed || Option.isSome(previous.failure))
        yield* SubscriptionRef.set(entry.state, { value: Option.some(exit.value), failure: Option.none() })
    })

    const start = Effect.fnUntraced(function* (key: string, entry: Entry) {
      const persist = entry.holders[0]?.persist
      const restored = persist
        ? Option.map(Schema.decodeUnknownOption(saved(persist))(yield* kv.get(savedKey(key))), (item) => item.value)
        : Option.none()
      if (Option.isSome(restored)) {
        yield* SubscriptionRef.set(entry.state, { value: restored, failure: Option.none() })
        yield* Deferred.done(entry.ready, Exit.void)
      }
      while (true) {
        yield* refresh(key, entry)
        yield* Deferred.done(entry.ready, Exit.void)
        const every = Duration.fromInputUnsafe(entry.holders[0]?.interval ?? interval)
        // Without a value its holders have nothing, so a failure tries again sooner than a long interval.
        const wait =
          entry.cause && Option.isNone((yield* SubscriptionRef.get(entry.state)).value)
            ? Duration.min(every, emptyRetry)
            : every
        yield* Duration.isFinite(wait) ? Effect.sleep(wait) : Effect.never
      }
    })

    const acquire = <A, E>(input: Input<A, E>) =>
      lock.withPermit(
        Effect.gen(function* () {
          const existing = entries.get(input.key)
          if (existing) {
            existing.holders.push(input as Input<unknown, unknown>)
            return existing
          }
          const entry: Entry = {
            holders: [input as Input<unknown, unknown>],
            state: yield* SubscriptionRef.make<State<unknown, unknown>>({
              value: Option.none(),
              failure: Option.none(),
            }),
            ready: yield* Deferred.make<void>(),
          }
          entries.set(input.key, entry)
          // A source stopped before its first load leaves nothing to wait for.
          entry.fiber = run(start(input.key, entry).pipe(Effect.ensuring(Deferred.interrupt(entry.ready))))
          return entry
        }),
      )

    const release = (key: string, entry: Entry, input: Input<unknown, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          entry.holders.splice(entry.holders.indexOf(input), 1)
          if (entry.holders.length > 0) return
          if (entries.get(key) === entry) entries.delete(key)
          if (entry.fiber) yield* Fiber.interrupt(entry.fiber)
        }),
      )

    // The key decides the value's type, so an entry under the same key holds this caller's types.
    const source = <A, E>(input: Input<A, E>) =>
      Effect.acquireRelease(acquire(input), (entry) =>
        release(input.key, entry, input as Input<unknown, unknown>),
      ).pipe(
        Effect.map(
          (entry): Source<A, E> => ({
            get: Deferred.await(entry.ready).pipe(
              Effect.andThen(SubscriptionRef.get(entry.state)),
              Effect.flatMap((state) =>
                Option.isSome(state.value)
                  ? Effect.succeed(state.value.value as A)
                  : Effect.failCause((entry.cause ?? Cause.die("no value")) as Cause.Cause<E>),
              ),
            ),
            current: SubscriptionRef.get(entry.state) as Effect.Effect<State<A, E>>,
            changes: SubscriptionRef.changes(entry.state) as Stream.Stream<State<A, E>>,
          }),
        ),
      )

    const forget = (prefix: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const stopped = yield* lock.withPermit(
          Effect.sync(() =>
            Array.from(entries).flatMap(([key, entry]) => {
              if (!key.startsWith(prefix)) return []
              entries.delete(key)
              return entry.fiber ? [entry.fiber] : []
            }),
          ),
        )
        yield* Effect.forEach(stopped, Fiber.interrupt, { discard: true })
        const page = yield* kv.scan({ prefix: savedKey(prefix), limit: 1000 })
        yield* Effect.forEach(page.entries, (item) => kv.remove(item.key), { discard: true })
        if (page.next) yield* forget(prefix)
      })

    return Service.of({ source, forget })
  }),
)

// Errors rarely implement `Equal`, so two failures of one kind with one message are the same failure.
function sameFailure(a: Option.Option<unknown>, b: Option.Option<unknown>) {
  if (Option.isNone(a) || Option.isNone(b)) return Option.isNone(a) && Option.isNone(b)
  if (Equal.equals(a.value, b.value)) return true
  return (
    a.value instanceof Error &&
    b.value instanceof Error &&
    a.value.constructor === b.value.constructor &&
    a.value.message === b.value.message
  )
}

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
