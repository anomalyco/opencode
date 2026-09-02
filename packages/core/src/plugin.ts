export * as Plugin from "./plugin.js"
export { Event, ID, Info, Source, State } from "@opencode-ai/schema/plugin"

import { Plugin } from "@opencode-ai/schema/plugin"
import { Node } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import type { PersistentPty } from "./persistent-pty.js"
import { Cause, Context, Effect, Exit, Latch, Layer, Logger, References, Scope, Semaphore } from "effect"
import { Bus } from "./bus.js"
import { KV } from "./kv.js"
import { PluginHost } from "./plugin/host.js"
import { type Failure, type Generation, Service } from "./plugin/service.js"
import { State } from "./state.js"

export { awaitActivation, type Generation, type Interface, Service } from "./plugin/service.js"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const kv = yield* KV.Service
    const scope = yield* Scope.make()
    const active = new Map<Plugin.ID, { readonly plugin: Generation; readonly scope: Scope.Closeable }>()
    const lock = Semaphore.makeUnsafe(1)
    const ready = yield* Latch.make(true)
    const pending = new Set<object>()
    const hold = () =>
      Effect.sync(() => {
        const token = {}
        pending.add(token)
        ready.closeUnsafe()
        return Effect.sync(() => {
          if (pending.delete(token) && pending.size === 0) ready.openUnsafe()
        })
      })
    let inventory: Plugin.Info[] = []
    const list = Effect.fn("Plugin.list")(function* () {
      return inventory
    })
    const host = yield* PluginHost.make({ list })
    const load = Effect.fnUntraced(function* (plugin: Generation) {
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
      plugins: readonly Generation[],
      failures: readonly Failure[] = [],
    ) {
      const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }))
      const ids = new Set<Plugin.ID>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* Effect.acquireUseRelease(
        hold(),
        () =>
          lock.withPermit(
            Effect.gen(function* () {
              const current = Array.from(active.values())
              const changed = definitions.findIndex((definition, index) => {
                const entry = current[index]
                return entry?.plugin.id !== definition.id || entry.plugin.revision !== definition.revision
              })
              const prefix = changed === -1 ? definitions.length : changed
              for (const definition of definitions.slice(0, prefix)) {
                const entry = active.get(definition.id)
                if (entry) active.set(definition.id, { ...entry, plugin: definition })
              }
              if (prefix === definitions.length && active.size === definitions.length) {
                const nextInventory = [...definitions.map(activeInfo), ...failures]
                if (JSON.stringify(inventory) === JSON.stringify(nextInventory)) return
                inventory = nextInventory
                yield* bus.publish(Plugin.Event.Updated, {})
                return
              }

              yield* State.batch(
                Effect.gen(function* () {
                  // Registrations are ordered by setup, so only the unchanged prefix can stay alive.
                  const previous = new Map(Array.from(active.entries()).slice(prefix))
                  yield* Effect.forEach(
                    Array.from(previous.entries()).toReversed(),
                    ([id, entry]) =>
                      Effect.gen(function* () {
                        active.delete(id)
                        yield* Scope.close(entry.scope, Exit.void)
                      }),
                    { discard: true },
                  )
                  const nextInventory = definitions.slice(0, prefix).map(activeInfo)
                  for (const definition of definitions.slice(prefix)) {
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

                    const fallback = previous.get(definition.id)
                    if (!fallback) continue
                    const restored = yield* load(fallback.plugin)
                    if (restored.scope !== undefined) {
                      active.set(definition.id, { plugin: fallback.plugin, scope: restored.scope })
                      continue
                    }
                    yield* Effect.logError("failed to restore plugin; deactivating", {
                      "plugin.id": definition.id,
                    })
                  }

                  inventory = [...nextInventory, ...failures]
                }),
              )
              yield* bus.publish(Plugin.Event.Updated, {})
            }),
          ),
        (release) => release,
      )
    })

    const close = (exit: Exit.Exit<unknown, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          active.clear()
          yield* State.shutdown(Scope.close(scope, exit))
        }),
      )
    yield* Effect.addFinalizer(close)

    return Service.of({
      activate,
      close,
      awaitActivation: ready.await,
      hold,
      list,
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

export const node: LayerNode.Provider<Service, PersistentPty.UnavailableError, typeof Node.tags.values.location> =
  Node.makeLocationNode({
    service: Service,
    layer,
    deps: [PluginHost.requirements],
  })
