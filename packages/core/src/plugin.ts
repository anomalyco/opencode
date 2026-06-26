export * as PluginV2 from "./plugin"

import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect"
import type { Plugin as PluginRuntime } from "@opencode-ai/plugin/v2/effect"
import { Plugin } from "@opencode-ai/schema/plugin"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { EventV2 } from "./event"
import { Integration } from "./integration"
import { KeyedMutex } from "./effect/keyed-mutex"
import { PluginHost } from "./plugin/host"
import { Reference } from "./reference"
import { SkillV2 } from "./skill"
import { State } from "./state"

export const ID = Plugin.ID
export type ID = typeof ID.Type
export const Event = Plugin.Event

export interface Interface {
  readonly add: (id: ID, effect: PluginRuntime["effect"]) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly wait: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Plugin") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const locks = KeyedMutex.makeUnsafe<ID>()
    const scope = yield* Scope.make()
    const active = new Map<ID, Scope.Closeable>()
    const loading = new Set<ID>()
    const waiters = new Map<ID, Set<Deferred.Deferred<void>>>()
    const failures = new Map<ID, Exit.Exit<void, never>>()
    let host: Parameters<PluginRuntime["effect"]>[0]

    const add = Effect.fn("Plugin.add")(function* (id: ID, effect: PluginRuntime["effect"]) {
      if (loading.has(id)) return yield* Effect.die(`Plugin load cycle detected for ${id}`)

      yield* locks.withLock(id)(
        Effect.sync(() => {
          loading.add(id)
          failures.delete(id)
        }).pipe(
          Effect.andThen(
            State.batch(
              Effect.gen(function* () {
                const existing = active.get(id)
                active.delete(id)
                if (existing) yield* Scope.close(existing, Exit.void).pipe(Effect.ignore)

                const child = yield* Scope.fork(scope)
                yield* effect(host).pipe(
                  Scope.provide(child),
                  Effect.withSpan("Plugin.load", { attributes: { "plugin.id": id } }),
                  Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
                )
                yield* events.publish(Event.Added, { id })
                active.set(id, child)
                yield* Effect.forEach(waiters.get(id) ?? [], (waiter) => Deferred.succeed(waiter, undefined), {
                  discard: true,
                })
                waiters.delete(id)
              }),
            ),
          ),
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            failures.set(id, exit)
            return Effect.forEach(waiters.get(id) ?? [], (waiter) => Deferred.done(waiter, exit), {
              discard: true,
            }).pipe(Effect.ensuring(Effect.sync(() => waiters.delete(id))))
          }),
          Effect.ensuring(Effect.sync(() => loading.delete(id))),
        ),
      )
    })

    const remove = Effect.fn("Plugin.remove")(function* (id: ID) {
      if (loading.has(id)) return yield* Effect.die(`Cannot remove plugin ${id} while it is loading`)

      yield* locks.withLock(id)(
        State.batch(
          Effect.gen(function* () {
            const current = active.get(id)
            active.delete(id)
            failures.delete(id)
            if (current) yield* Scope.close(current, Exit.void).pipe(Effect.ignore)
          }),
        ),
      )
    })

    const wait = Effect.fn("Plugin.wait")(function* (id: ID) {
      const waiter = yield* Deferred.make<void>()
      const pending = yield* locks.withLock(id)(
        Effect.sync(() => {
          if (active.has(id)) return false
          const failure = failures.get(id)
          if (failure) return failure
          const current = waiters.get(id) ?? new Set()
          current.add(waiter)
          waiters.set(id, current)
          return true
        }),
      )
      if (!pending) return
      if (typeof pending !== "boolean") return yield* pending
      yield* Deferred.await(waiter).pipe(
        Effect.ensuring(
          locks.withLock(id)(
            Effect.sync(() => {
              const current = waiters.get(id)
              current?.delete(waiter)
              if (current?.size === 0) waiters.delete(id)
            }),
          ),
        ),
      )
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
        yield* State.batch(Scope.close(scope, exit))
      }),
    )

    const service = Service.of({
      add,
      remove,
      wait,
    })
    host = yield* PluginHost.make(service)
    return service
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(AgentV2.locationLayer),
  Layer.provideMerge(AISDK.locationLayer),
  Layer.provideMerge(Catalog.locationLayer),
  Layer.provideMerge(CommandV2.locationLayer),
  Layer.provideMerge(Integration.locationLayer),
  Layer.provideMerge(Reference.locationLayer),
  Layer.provideMerge(SkillV2.locationLayer),
)
