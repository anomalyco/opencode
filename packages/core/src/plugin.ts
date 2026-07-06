export * as PluginV2 from "./plugin"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Event, ID, type Info } from "@opencode-ai/schema/plugin"
import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Exit, Layer, Scope, Semaphore } from "effect"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { EventV2 } from "./event"
import { Integration } from "./integration"
import { Location } from "./location"
import { PluginHost } from "./plugin/host"
import { PluginRuntime } from "./plugin/runtime"
import { Reference } from "./reference"
import { SkillV2 } from "./skill"
import { State } from "./state"
import { ToolRegistry } from "./tool/registry"
import { ToolHooks } from "./tool/hooks"

export interface Interface {
  readonly activate: (plugins: readonly { readonly plugin: Plugin; readonly version?: string }[]) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const scope = yield* Scope.make()
    const active = new Map<typeof ID.Type, Scope.Closeable>()
    const lock = Semaphore.makeUnsafe(1)
    let generation: readonly { readonly id: typeof ID.Type; readonly version?: string }[] | undefined = []
    let host: Parameters<Plugin["effect"]>[0]

    const activate = Effect.fn("Plugin.activate")(function* (
      plugins: readonly { readonly plugin: Plugin; readonly version?: string }[],
    ) {
      const definitions = plugins.map((entry) => ({
        ...entry.plugin,
        id: ID.make(entry.plugin.id),
        ...(entry.version === undefined ? {} : { version: entry.version }),
      }))
      const ids = new Set<typeof ID.Type>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) return yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* lock.withPermit(
        Effect.gen(function* () {
          if (
            generation !== undefined &&
            generation.length === definitions.length &&
            generation.every(
              (plugin, index) => plugin.id === definitions[index]?.id && plugin.version === definitions[index]?.version,
            )
          ) {
            return
          }
          generation = undefined
          const exit = yield* State.batch(
            Effect.gen(function* () {
              const scopes = Array.from(active.values()).toReversed()
              active.clear()
              const inherit = yield* State.inherit()
              yield* Effect.forEach(scopes, (scope) => Scope.close(scope, Exit.void).pipe(Effect.ignore), {
                discard: true,
              })

              for (const definition of definitions) {
                const child = yield* Scope.fork(scope)
                const loaded = yield* Effect.suspend(() => definition.effect(host)).pipe(
                  inherit,
                  Effect.updateContext((_context: Context.Context<never>) => Context.make(Scope.Scope, child)),
                  Effect.withSpan("Plugin.load", { attributes: { "plugin.id": definition.id } }),
                  Effect.andThen(events.publish(Event.Added, { id: definition.id })),
                  Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
                  Effect.exit,
                )
                if (Exit.isFailure(loaded)) return loaded
                active.set(definition.id, child)
              }
              return Exit.void
            }),
          )
          if (Exit.isFailure(exit)) return yield* exit
          generation = definitions.map((definition) => ({
            id: definition.id,
            ...(definition.version === undefined ? {} : { version: definition.version }),
          }))
          yield* events.publish(Event.Updated, {})
        }),
      )
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
        generation = []
        yield* State.batch(Scope.close(scope, exit))
      }),
    )

    const service = Service.of({
      activate,
      list: Effect.fn("Plugin.list")(function* () {
        return Array.from(active.keys()).map((id) => ({ id }))
      }),
    })
    host = yield* PluginHost.make(service)
    return service
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Location.node,
    Reference.node,
    SkillV2.node,
    ToolRegistry.toolsNode,
    ToolHooks.node,
    PluginRuntime.node,
  ],
})
