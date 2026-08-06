export * as Plugin from "./plugin"
export { Event, ID, Info } from "@opencode-ai/schema/plugin"

import { Plugin } from "@opencode-ai/schema/plugin"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "./app"
import { Context, Effect, Exit, Layer, Scope, Semaphore } from "effect"
import { Agent } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { Command } from "./command"
import { Bus } from "./bus"
import { Integration } from "./integration"
import { Location } from "./location"
import { PluginHost } from "./plugin/host"
import { PluginRuntime } from "./plugin/runtime"
import { WebSearch } from "./websearch"
import { Reference } from "./reference"
import { Skill } from "./skill"
import { State } from "./state"
import { Tool } from "./tool"
import { PluginHooks } from "./plugin/hooks"

export interface Interface {
  readonly activate: (plugins: readonly Versioned[]) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Plugin.Info[]>
}

export type Versioned = import("@opencode-ai/plugin/effect/plugin").Plugin & { readonly version: string }

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const scope = yield* Scope.make()
    const active = new Map<Plugin.ID, { readonly plugin: Versioned; readonly scope: Scope.Closeable }>()
    const lock = Semaphore.makeUnsafe(1)
    let host: Parameters<import("@opencode-ai/plugin/effect/plugin").Plugin["effect"]>[0]

    const load = Effect.fnUntraced(function* (plugin: Versioned) {
      const child = yield* Scope.fork(scope)
      const inherit = yield* State.inherit()
      const loaded = yield* Effect.suspend(() => plugin.effect(host)).pipe(
        inherit,
        Effect.updateContext((_context: Context.Context<never>) => Context.make(Scope.Scope, child)),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.andThen(bus.publish(Plugin.Event.Added, { id: Plugin.ID.make(plugin.id) })),
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

    const activate = Effect.fn("Plugin.activate")(function* (plugins: readonly Versioned[]) {
      const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }))
      const ids = new Set<Plugin.ID>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* lock.withPermit(
        Effect.gen(function* () {
          const next = definitions.map((definition) => ({ id: definition.id, version: definition.version }))
          const current = Array.from(active.values(), (entry) => ({
            id: entry.plugin.id,
            version: entry.plugin.version,
          }))
          if (
            current.length === next.length &&
            current.every((definition, index) => {
              const candidate = next[index]
              return definition.id === candidate?.id && definition.version === candidate.version
            })
          )
            return

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
          yield* bus.publish(Plugin.Event.Updated, {})
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
    Bus.node,
    App.node,
    Agent.node,
    AISDK.node,
    Catalog.node,
    Command.node,
    Integration.node,
    Location.node,
    Reference.node,
    Skill.node,
    Tool.node,
    PluginHooks.node,
    PluginRuntime.node,
    WebSearch.node,
  ],
})
