export * as PluginUpdate from "./update.js"

import { Context, Effect, Exit, Layer, Option, PubSub, Stream } from "effect"
import { Npm } from "@opencode/util/npm"
import { EffectFlock } from "@opencode/util/effect-flock"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex.js"

/** How often package plugins are checked for newer versions. */
export const interval = 24 * 60 * 60 * 1_000

interface Change {
  readonly target: string
  readonly outdated: boolean
  readonly updating: boolean
}

export interface Interface {
  readonly check: (target: string, options?: { readonly refresh?: boolean }) => Effect.Effect<boolean>
  readonly update: (target: string) => Effect.Effect<void, Npm.InstallFailedError | EffectFlock.LockError>
  readonly changes: () => Stream.Stream<Change>
  /** Emits the number of each new check interval. Checks after it ask the registry or Git remote again. */
  readonly intervals: () => Stream.Stream<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginUpdate") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const npm = yield* Npm.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    // A result stays fresh until its interval ends, however late in the interval it was checked. A fixed age from the
    // check would still be fresh when the next interval starts, skipping that interval's check.
    const status = new Map<string, { readonly outdated: boolean; readonly cycle: number }>()
    const changes = yield* PubSub.unbounded<Change>()
    const intervals = yield* PubSub.unbounded<number>()
    let cycle = 0
    yield* Effect.sleep(interval).pipe(
      Effect.andThen(Effect.suspend(() => PubSub.publish(intervals, ++cycle))),
      Effect.forever,
      Effect.forkScoped,
    )

    return Service.of({
      check: (target, options) =>
        locks.withLock(target)(
          Effect.gen(function* () {
            const checking = cycle
            const previous = status.get(target)
            if (!options?.refresh && previous?.cycle === checking) return previous.outdated
            const outdated = yield* npm.check(target).pipe(
              Effect.tapCause((cause) => Effect.logWarning("failed to check plugin update", { target, cause })),
              Effect.option,
            )
            const value = Option.getOrElse(outdated, () => previous?.outdated ?? false)
            status.set(target, { outdated: value, cycle: checking })
            if ((previous?.outdated ?? false) !== value)
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
      intervals: () => Stream.fromPubSub(intervals),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Npm.node] })
