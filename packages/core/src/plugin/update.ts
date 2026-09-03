export * as PluginUpdate from "./update.js"

import { Clock, Context, Effect, Exit, Layer, Option, PubSub, Stream } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { EffectFlock } from "@opencode-ai/util/effect-flock"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex.js"

const interval = 24 * 60 * 60 * 1_000

interface Change {
  readonly target: string
  readonly outdated: boolean
  readonly updating: boolean
}

export interface Interface {
  readonly check: (target: string, options?: { readonly refresh?: boolean }) => Effect.Effect<boolean>
  readonly update: (target: string) => Effect.Effect<void, Npm.InstallFailedError | EffectFlock.LockError>
  readonly changes: () => Stream.Stream<Change>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginUpdate") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const status = new Map<string, { readonly outdated: boolean; readonly checkedAt: number }>()
    const changes = yield* PubSub.unbounded<Change>()

    return Service.of({
      check: (target, options) =>
        locks.withLock(target)(
          Effect.gen(function* () {
            const checkedAt = yield* Clock.currentTimeMillis
            const current = status.get(target)
            if (!options?.refresh && current && checkedAt - current.checkedAt < interval) return current.outdated
            const outdated = yield* npm.check(target).pipe(
              Effect.tapCause((cause) => Effect.logWarning("failed to check plugin update", { target, cause })),
              Effect.option,
            )
            const value = Option.getOrElse(outdated, () => current?.outdated ?? false)
            status.set(target, { outdated: value, checkedAt })
            if ((current?.outdated ?? false) !== value)
              yield* PubSub.publish(changes, { target, outdated: value, updating: false })
            return value
          }),
        ),
      // Serialize per target so a concurrent update cannot clear the in-progress flag of another still running.
      update: (target) =>
        locks.withLock(target)(
          Effect.gen(function* () {
            const outdated = status.get(target)?.outdated ?? false
            yield* PubSub.publish(changes, { target, outdated, updating: true })
            yield* npm.update(target).pipe(
              Effect.tap(() => Effect.sync(() => status.delete(target))),
              Effect.onExit((exit) =>
                PubSub.publish(changes, {
                  target,
                  outdated: Exit.isSuccess(exit) ? false : outdated,
                  updating: false,
                }),
              ),
            )
          }),
        ),
      changes: () => Stream.fromPubSub(changes),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Npm.node] })
