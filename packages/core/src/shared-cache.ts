export * as SharedCache from "./shared-cache.js"

import { Clock, Context, Duration, Effect, Exit, Fiber, FiberSet, Layer } from "effect"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Interface {
  /**
   * Returns the result of the last load for `key` while it is newer than `maxAge`, otherwise joins the load running
   * for `key` or starts one; `force` skips the age check but still joins a running load. A failed load keeps the last
   * good value, or without one is returned to every caller until `maxAge` passes, so a key loads at most once per
   * `maxAge`. The key must include everything that changes the answer, such as the connection and base URL, but
   * never a raw secret: use `fingerprint` for a static API key.
   */
  readonly get: <A, E>(input: {
    readonly key: string
    readonly load: Effect.Effect<A, E>
    readonly maxAge: Duration.Input
    readonly force?: boolean
  }) => Effect.Effect<A, E>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SharedCache") {}

/** A short, one-way stand-in for a static secret in a cache key, so a key changed in place loads again. */
export const fingerprint = (secret: string) => Hash.sha256(secret).slice(0, 16)

interface Entry {
  good?: { readonly value: unknown }
  last?: { readonly exit: Exit.Exit<unknown, unknown>; readonly time: number }
  loading?: Fiber.Fiber<unknown, unknown>
  read: number
}

const unread = Duration.toMillis(Duration.hours(1))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const run = yield* FiberSet.runtime(yield* FiberSet.make<unknown, unknown>())()
    const entries = new Map<string, Entry>()

    const get = Effect.fnUntraced(function* <A, E>(
      input: Parameters<Interface["get"]>[0] & {
        readonly load: Effect.Effect<A, E>
      },
    ) {
      const now = yield* Clock.currentTimeMillis
      for (const [key, item] of entries) if (!item.loading && now - item.read > unread) entries.delete(key)
      const entry = entries.get(input.key) ?? { read: now }
      entries.set(input.key, entry)
      entry.read = now
      // The key decides the value's type, so a stored or joined result under the same key has this caller's types.
      if (!input.force && entry.last && now - entry.last.time < Duration.toMillis(input.maxAge))
        return yield* entry.last.exit as Exit.Exit<A, E>
      // Yield first so `entry.loading` is set before a synchronous load can finish and clear it.
      entry.loading ??= run(
        Effect.gen(function* () {
          yield* Effect.yieldNow
          const exit = yield* Effect.exit(input.load)
          if (Exit.isSuccess(exit)) entry.good = { value: exit.value }
          else yield* Effect.logWarning("failed to load shared value", { key: input.key, cause: exit.cause })
          entry.last = {
            exit: Exit.isFailure(exit) && entry.good ? Exit.succeed(entry.good.value) : exit,
            time: yield* Clock.currentTimeMillis,
          }
          return yield* entry.last.exit
        }).pipe(
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
