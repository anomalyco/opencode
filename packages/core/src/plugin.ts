export * as PluginV2 from "./plugin"

import type { Plugin } from "@opencode-ai/plugin/v2/effect/plugin"
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
import { PluginHooks } from "./plugin/hooks"

export interface Interface {
  readonly activate: (plugins: readonly Plugin[]) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const scope = yield* Scope.make()
    const active = new Map<typeof ID.Type, { readonly plugin: Plugin; readonly scope: Scope.Closeable }>()
    const lock = Semaphore.makeUnsafe(1)
    let host: Parameters<Plugin["effect"]>[0]

    const load = Effect.fnUntraced(function* (plugin: Plugin) {
      const child = yield* Scope.fork(scope)
      const inherit = yield* State.inherit()
      const loaded = yield* Effect.suspend(() => plugin.effect(host)).pipe(
        inherit,
        Effect.updateContext((_context: Context.Context<never>) => Context.make(Scope.Scope, child)),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.andThen(events.publish(Event.Added, { id: ID.make(plugin.id) })),
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
        Effect.exit,
      )
      if (Exit.isSuccess(loaded)) return child
      yield* Effect.logWarning("failed to load plugin", {
        "plugin.id": plugin.id,
        cause: loaded.cause,
      })
      return undefined
    })

    const activate = Effect.fn("Plugin.activate")(function* (plugins: readonly Plugin[]) {
      const definitions = plugins.map((plugin) => ({ ...plugin, id: ID.make(plugin.id) }))
      const ids = new Set<typeof ID.Type>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* lock.withPermit(
        Effect.gen(function* () {
          yield* State.batch(
            Effect.gen(function* () {
              for (const definition of definitions) {
                const previous = active.get(definition.id)
                active.delete(definition.id)
                if (previous) yield* Scope.close(previous.scope, Exit.void).pipe(Effect.ignore)

                const loaded = yield* load(definition)
                if (loaded) {
                  active.set(definition.id, { plugin: definition, scope: loaded })
                  continue
                }

                if (!previous) continue
                const restored = yield* load(previous.plugin)
                if (restored) {
                  active.set(definition.id, { plugin: previous.plugin, scope: restored })
                  continue
                }
                yield* Effect.logError("failed to restore plugin; deactivating", {
                  "plugin.id": definition.id,
                })
              }

              const removed = Array.from(active.entries())
                .filter(([id]) => !ids.has(id))
                .toReversed()
              removed.forEach(([id]) => active.delete(id))
              yield* Effect.forEach(removed, ([, entry]) => Scope.close(entry.scope, Exit.void).pipe(Effect.ignore), {
                discard: true,
              })
            }),
          )
          yield* events.publish(Event.Updated, {})
        }),
      )
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
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
    PluginHooks.node,
    PluginRuntime.node,
  ],
})
