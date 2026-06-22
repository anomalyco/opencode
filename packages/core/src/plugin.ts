export * as PluginV2 from "./plugin"

import { Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import type { Plugin, PluginDraft } from "@opencode-ai/plugin/v2/effect"
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
  readonly transform: State.Transform<PluginDraft>
  readonly reload: State.Reload
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Plugin") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const locks = KeyedMutex.makeUnsafe<ID>()
    const scope = yield* Scope.make()
    const active = new Map<ID, Scope.Closeable>()
    let host: Parameters<Plugin["effect"]>[0]

    const attach = Effect.fn("Plugin.attach")(function* (plugin: Plugin, host: Parameters<Plugin["effect"]>[0]) {
      const id = ID.make(plugin.id)
      yield* locks.withLock(id)(
        Effect.gen(function* () {
          const existing = active.get(id)
          if (existing) yield* Scope.close(existing, Exit.void).pipe(Effect.ignore)

          const child = yield* Scope.fork(scope)
          yield* plugin.effect(host).pipe(
            Scope.provide(child),
            Effect.withSpan("Plugin.load", { attributes: { "plugin.id": id } }),
            Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
          )
          active.set(id, child)
          yield* events.publish(Event.Added, { id })
        }),
      )
    })

    const detach = Effect.fn("Plugin.detach")(function* (id: ID) {
      yield* locks.withLock(id)(
        Effect.gen(function* () {
          const current = active.get(id)
          active.delete(id)
          if (current) yield* Scope.close(current, Exit.void).pipe(Effect.ignore)
        }),
      )
    })

    const state = State.create<Map<ID, Plugin>, PluginDraft>({
      initial: () => new Map(),
      draft: (draft) => ({
        list: () => Array.from(draft.values()),
        add: (plugin) => draft.set(ID.make(plugin.id), plugin),
        remove: (id) => draft.delete(ID.make(id)),
      }),
      finalize: (draft) =>
        State.batch(
          Effect.gen(function* () {
            const desired = new Set<ID>()
            for (const plugin of draft.list()) desired.add(ID.make(plugin.id))

            for (const id of active.keys()) {
              if (!desired.has(id)) yield* detach(id)
            }

            for (const plugin of draft.list()) yield* attach(plugin, host)
          }).pipe(Effect.withSpan("Plugin.reconcile")),
        ),
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
        yield* State.batch(Scope.close(scope, exit))
      }),
    )

    const service = Service.of({
      transform: state.transform,
      reload: state.reload,
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
