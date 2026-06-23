export * as PluginV2 from "./plugin"

import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import type { Plugin } from "@opencode-ai/plugin/v2/effect"
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

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export const Event = {
  Added: EventV2.define({
    type: "plugin.added",
    schema: {
      id: ID,
    },
  }),
}

export interface Interface {
  readonly add: (id: ID, effect: Plugin["effect"]) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
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
    let host: Parameters<Plugin["effect"]>[0]

    const add = Effect.fn("Plugin.add")(function* (id: ID, effect: Plugin["effect"]) {
      if (loading.has(id)) return yield* Effect.die(`Plugin load cycle detected for ${id}`)

      yield* locks.withLock(id)(
        Effect.sync(() => loading.add(id)).pipe(
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
                active.set(id, child)
                yield* events.publish(Event.Added, { id })
              }),
            ),
          ),
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
            if (current) yield* Scope.close(current, Exit.void).pipe(Effect.ignore)
          }),
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
