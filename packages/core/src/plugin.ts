export * as Plugin from "./plugin.js"
export { Event, ID, Info, Source } from "@opencode-ai/schema/plugin"

import { Plugin } from "@opencode-ai/schema/plugin"
import type { Plugin as PluginDefinition } from "@opencode-ai/plugin/effect/plugin"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "./app.js"
import { Cause, Context, Effect, Exit, Layer, Logger, References, Scope, Semaphore } from "effect"
import { Agent } from "./agent.js"
import { AISDK } from "./aisdk.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { KV } from "./kv.js"
import { Mcp } from "./mcp/index.js"
import { Location } from "./location.js"
import { PluginHost } from "./plugin/host.js"
import { PluginRuntime } from "./plugin/runtime.js"
import { WebSearch } from "./websearch.js"
import { Reference } from "./reference.js"
import { Skill } from "./skill.js"
import { State } from "./state.js"
import { Tool } from "./tool.js"
import { Vcs } from "./vcs.js"
import { PluginHooks } from "./plugin/hooks.js"
import { Generate } from "./generate.js"
import { Permission } from "./permission.js"

export interface Interface {
  readonly activate: (
    plugins: readonly Versioned[],
    failures?: readonly Extract<Plugin.Info, { readonly status: "failed" }>[],
  ) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Plugin.Info[]>
}

export type Versioned = PluginDefinition & {
  readonly version: string
  readonly source?: Plugin.Source
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const kv = yield* KV.Service
    const scope = yield* Scope.make()
    const active = new Map<Plugin.ID, { readonly plugin: Versioned; readonly scope: Scope.Closeable }>()
    const lock = Semaphore.makeUnsafe(1)
    let inventory: Plugin.Info[] = []
    let host: Parameters<PluginDefinition["effect"]>[0]
    const load = Effect.fnUntraced(function* (plugin: Versioned) {
      const child = yield* Scope.fork(scope)
      const inherit = yield* State.inherit()
      const loaded = yield* Effect.suspend(() =>
        plugin.effect({ ...host, storage: PluginHost.storage(kv, plugin.id) }),
      ).pipe(
        inherit,
        Effect.updateContext((context: Context.Context<never>) =>
          Context.make(Scope.Scope, child).pipe(
            Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
            Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
          ),
        ),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.andThen(bus.publish(Plugin.Event.Added, { id: Plugin.ID.make(plugin.id) })),
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
        Effect.exit,
      )
      if (Exit.isSuccess(loaded)) return { scope: child } as const
      yield* Effect.logWarning("failed to load plugin", {
        "plugin.id": plugin.id,
        cause: loaded.cause,
      })
      return { error: Cause.pretty(loaded.cause) } as const
    })

    const activate = Effect.fn("Plugin.activate")(function* (
      plugins: readonly Versioned[],
      failures: readonly Extract<Plugin.Info, { readonly status: "failed" }>[] = [],
    ) {
      const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }))
      const ids = new Set<Plugin.ID>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* lock.withPermit(
        Effect.gen(function* () {
          if (
            active.size === definitions.length &&
            Array.from(active.values()).every((entry, index) => {
              const definition = definitions[index]
              return entry.plugin.id === definition?.id && entry.plugin.version === definition.version
            })
          ) {
            const nextInventory = [...Array.from(active.values(), (entry) => activeInfo(entry.plugin)), ...failures]
            if (JSON.stringify(inventory) === JSON.stringify(nextInventory)) return
            inventory = nextInventory
            yield* bus.publish(Plugin.Event.Updated, {})
            return
          }

          yield* State.batch(
            Effect.gen(function* () {
              const nextInventory: Plugin.Info[] = []
              for (const definition of definitions) {
                const previous = active.get(definition.id)
                active.delete(definition.id)
                if (previous) yield* Scope.close(previous.scope, Exit.void).pipe(Effect.ignore)

                const loaded = yield* load(definition)
                if (loaded.scope !== undefined) {
                  active.set(definition.id, { plugin: definition, scope: loaded.scope })
                  nextInventory.push(activeInfo(definition))
                  continue
                }
                nextInventory.push({
                  id: definition.id,
                  source: definition.source ?? { type: "builtin" },
                  status: "failed",
                  error: loaded.error,
                  tui: definition.tui ?? false,
                })

                if (!previous) continue
                const restored = yield* load(previous.plugin)
                if (restored.scope !== undefined) {
                  active.set(definition.id, { plugin: previous.plugin, scope: restored.scope })
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
              inventory = [...nextInventory, ...failures]
            }),
          )
          yield* bus.publish(Plugin.Event.Updated, {})
        }),
      )
    })

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        active.clear()
        yield* State.batch(Scope.close(scope, exit), { flush: false })
      }),
    )

    const service = Service.of({
      activate,
      list: Effect.fn("Plugin.list")(function* () {
        return inventory
      }),
    })
    host = yield* PluginHost.make(service)
    return service
  }),
)

function activeInfo(plugin: Versioned): Plugin.Info {
  return {
    id: Plugin.ID.make(plugin.id),
    source: plugin.source ?? { type: "builtin" },
    status: "active",
    tui: plugin.tui ?? false,
  }
}

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
    KV.node,
    Mcp.node,
    Location.node,
    Reference.node,
    Skill.node,
    Tool.node,
    Vcs.node,
    PluginHooks.node,
    PluginRuntime.node,
    WebSearch.node,
    Generate.node,
    Permission.node,
  ],
})
