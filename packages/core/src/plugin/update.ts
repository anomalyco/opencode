export * as PluginUpdate from "./update.js"

import { Clock, Context, Effect, Layer, Option, PubSub, Stream } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { EffectFlock } from "@opencode-ai/util/effect-flock"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex.js"

const interval = 24 * 60 * 60 * 1_000

export interface Interface {
  readonly check: (target: string) => Effect.Effect<boolean>
  readonly update: (target: string) => Effect.Effect<void, Npm.InstallFailedError | EffectFlock.LockError>
  readonly changes: () => Stream.Stream<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginUpdate") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const status = new Map<string, { readonly outdated: boolean; readonly checkedAt: number }>()
    const changes = yield* PubSub.unbounded<string>()

    return Service.of({
      check: (target) =>
        locks.withLock(target)(
          Effect.gen(function* () {
            const checkedAt = yield* Clock.currentTimeMillis
            const current = status.get(target)
            if (current && checkedAt - current.checkedAt < interval) return current.outdated
            const outdated = yield* npm.check(target).pipe(
              Effect.tapCause((cause) => Effect.logWarning("failed to check plugin update", { target, cause })),
              Effect.option,
            )
            const value = Option.getOrElse(outdated, () => current?.outdated ?? false)
            status.set(target, { outdated: value, checkedAt })
            return value
          }),
        ),
      update: (target) =>
        npm.update(target).pipe(
          Effect.tap(() => Effect.sync(() => status.delete(target))),
          Effect.tap(() => PubSub.publish(changes, target)),
          Effect.asVoid,
        ),
      changes: () => Stream.fromPubSub(changes),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Npm.node] })
