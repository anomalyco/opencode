export * as Plugin from "./plugin.js"
export { Event, ID, Info, Source, State } from "@opencode-ai/schema/plugin"

import { Plugin } from "@opencode-ai/schema/plugin"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Cause, Context, Effect, Exit, Layer, Logger, References, Scope, Semaphore } from "effect"
import { Bus } from "./bus.js"
import { State } from "./state.js"

export interface Interface {
  readonly activate: (plugins: readonly Generation[], failures?: readonly Failure[]) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Plugin.Info[]>
  readonly close: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
}

type Failure = Plugin.Info & { readonly state: Extract<Plugin.State, { readonly status: "failed" }> }

/** Setup dependencies are bound before activation; the runner supplies the plugin's Scope. */
export interface Generation {
  readonly id: string
  readonly revision: string
  readonly source?: Plugin.Source
  readonly features?: Plugin.Features
  readonly effect: Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const scope = yield* Scope.make()
    const active = new Map<Plugin.ID, { readonly plugin: Generation; readonly scope: Scope.Closeable }>()
    const lock = Semaphore.makeUnsafe(1)
    let inventory: Plugin.Info[] = []
    const load = Effect.fnUntraced(function* (plugin: Generation) {
      const child = yield* Scope.fork(scope)
      const inherit = yield* State.inherit()
      const loaded = yield* plugin.effect.pipe(
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
      plugins: readonly Generation[],
      failures: readonly Failure[] = [],
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
              return entry.plugin.id === definition?.id && entry.plugin.revision === definition.revision
            })
          ) {
            for (const definition of definitions) {
              const entry = active.get(definition.id)
              if (entry) active.set(definition.id, { ...entry, plugin: definition })
            }
            const nextInventory = [...definitions.map(activeInfo), ...failures]
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
                if (previous) yield* Scope.close(previous.scope, Exit.void)

                const loaded = yield* load(definition)
                if (loaded.scope !== undefined) {
                  active.set(definition.id, { plugin: definition, scope: loaded.scope })
                  nextInventory.push(activeInfo(definition))
                  continue
                }
                nextInventory.push({
                  id: definition.id,
                  source: definition.source ?? { type: "builtin" },
                  state: { status: "failed", error: loaded.error },
                  features: { server: true, ...definition.features },
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
              yield* Effect.forEach(removed, ([, entry]) => Scope.close(entry.scope, Exit.void), {
                discard: true,
              })
              inventory = [...nextInventory, ...failures]
            }),
          )
          yield* bus.publish(Plugin.Event.Updated, {})
        }),
      )
    })

    const close = (exit: Exit.Exit<unknown, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          active.clear()
          yield* State.batch(Scope.close(scope, exit), { flush: false })
        }),
      )
    yield* Effect.addFinalizer(close)

    return Service.of({
      activate,
      close,
      list: Effect.fn("Plugin.list")(function* () {
        return inventory
      }),
    })
  }),
)

function activeInfo(plugin: Generation): Plugin.Info {
  return {
    id: Plugin.ID.make(plugin.id),
    source: plugin.source ?? { type: "builtin" },
    state: { status: "active" },
    features: { server: true, ...plugin.features },
  }
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})
