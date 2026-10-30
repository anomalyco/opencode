export * as SharedCache from "./shared-cache.js"

import { Clock, Context, Duration, Effect, Fiber, FiberSet, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Interface {
  /**
   * Returns the value stored for `key` when it is newer than `maxAge`, joins a load already running for `key`, or
   * runs `load`. A failed load keeps the last good value for another `maxAge`; without one it fails and the next
   * call loads again.
   * The key must include everything that changes the answer, such as the connection and base URL, but never a token.
   */
  readonly get: <A, E>(input: {
    readonly key: string
    readonly load: Effect.Effect<A, E>
    readonly maxAge: Duration.Input
  }) => Effect.Effect<A, E>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SharedCache") {}

interface Entry {
  value?: { readonly current: unknown; readonly time: number }
  loading?: Fiber.Fiber<unknown, unknown>
  read: number
}

const unread = Duration.toMillis(Duration.hours(1))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const run = yield* FiberSet.runtime(yield* FiberSet.make<unknown, unknown>())()
    const entries = new Map<string, Entry>()

    const get = Effect.fnUntraced(function* <A, E>(input: {
      readonly key: string
      readonly load: Effect.Effect<A, E>
      readonly maxAge: Duration.Input
    }) {
      const now = yield* Clock.currentTimeMillis
      for (const [key, item] of entries) if (!item.loading && now - item.read > unread) entries.delete(key)
      const entry = entries.get(input.key) ?? { read: now }
      entries.set(input.key, entry)
      entry.read = now
      if (entry.value && now - entry.value.time < Duration.toMillis(input.maxAge)) return entry.value.current as A
      // Yield first so `entry.loading` is set before a synchronous load can finish and clear it.
      entry.loading ??= run(
        Effect.yieldNow.pipe(
          Effect.andThen(input.load),
          Effect.tap((current) =>
            Clock.currentTimeMillis.pipe(
              Effect.map((time) => {
                entry.value = { current, time }
              }),
            ),
          ),
          Effect.catchCause((cause) => {
            const last = entry.value
            if (!last) return Effect.failCause(cause)
            // A failure waits a full maxAge like a success, so every caller does not retry it.
            return Clock.currentTimeMillis.pipe(
              Effect.map((time) => {
                entry.value = { current: last.current, time }
              }),
              Effect.andThen(Effect.logWarning("failed to load shared value", { key: input.key, cause })),
              Effect.as(last.current),
            )
          }),
          Effect.ensuring(
            Effect.sync(() => {
              entry.loading = undefined
            }),
          ),
        ),
      )
      // The key decides the value's type, so a load joined under the same key has this caller's types.
      return yield* Fiber.join(entry.loading as Fiber.Fiber<A, E>)
    })

    return Service.of({ get })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
