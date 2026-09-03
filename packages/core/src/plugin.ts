export * as Plugin from "./plugin.js"
export { Event, ID, Info, Source, State } from "@opencode-ai/schema/plugin"

import { Plugin } from "@opencode-ai/schema/plugin"
import { Node } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import type { PersistentPty } from "./persistent-pty.js"
import { Cause, Context, Effect, Exit, Latch, Layer, Logger, Queue, References, Scope, Semaphore } from "effect"
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
    // One slot per requested definition in activation order, including ones whose setup failed, so
    // the prefix diff below stays index-aligned and a failed revision is not retried until it changes.
    const active = new Map<Plugin.ID, Slot>()
    const lock = Semaphore.makeUnsafe(1)
    const ready = yield* Latch.make(true)
    const pending = new Set<object>()
    let closed = false
    const holdUnsafe = () => {
      if (closed) return Effect.void
      const token = {}
      pending.add(token)
      ready.closeUnsafe()
      return Effect.sync(() => {
        if (pending.delete(token) && pending.size === 0) ready.openUnsafe()
      })
    }
    const hold = () => Effect.sync(holdUnsafe)
    const quarantines = yield* Queue.unbounded<Quarantine>()
    let discovered: readonly Failure[] = []
    let inventory: Plugin.Info[] = []
    const list = Effect.fn("Plugin.list")(function* () {
      return inventory
    })
    const host = yield* PluginHost.make({ list })
    const load = Effect.fnUntraced(function* (plugin: Generation) {
      const child = yield* Scope.fork(scope)
      const inherit = yield* State.inherit()
      let failed: Quarantine | undefined
      const owned = State.owner((failure, refresh) => {
        failed = {
          plugin,
          scope: child,
          failure,
          refresh,
          error: `Plugin disabled after ${failure.state}.transform failed. Check server logs for details.`,
          ref: `err_${crypto.randomUUID().slice(0, 8)}`,
          release: holdUnsafe(),
        }
        Queue.offerUnsafe(quarantines, failed)
      })
      const loaded = yield* Effect.suspend(() =>
        plugin.effect({ ...host, storage: PluginHost.storage(kv, plugin.id) }),
      ).pipe(
        owned,
        inherit,
        Effect.updateContext((context: Context.Context<never>) =>
          Context.make(Scope.Scope, child).pipe(
            Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
            Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
          ),
        ),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.onExit((exit) => (Exit.isFailure(exit) && !failed ? Scope.close(child, exit) : Effect.void)),
        Effect.exit,
      )
      if (failed) return { error: failed.error, ref: failed.ref, quarantined: true } as const
      if (Exit.isSuccess(loaded)) return { scope: child } as const
      yield* Effect.logWarning("failed to load plugin", {
        "plugin.id": plugin.id,
        cause: loaded.cause,
      })
      return { error: Cause.pretty(loaded.cause), ref: undefined, quarantined: false } as const
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
              if (closed) return
              discovered = failures
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
                const nextInventory = [...Array.from(active.values()).map(slotInfo), ...failures]
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
                    ([id, slot]) =>
                      Effect.gen(function* () {
                        active.delete(id)
                        if (slot.loaded) yield* Scope.close(slot.loaded.scope, Exit.void)
                      }),
                    { discard: true },
                  )
                  for (const definition of definitions.slice(prefix)) {
                    const loaded = yield* load(definition)
                    if (loaded.scope !== undefined) {
                      active.set(definition.id, {
                        plugin: definition,
                        loaded: { plugin: definition, scope: loaded.scope },
                      })
                      continue
                    }
                    active.set(definition.id, { plugin: definition, error: loaded.error, ref: loaded.ref })
                    if (loaded.quarantined) continue

                    const fallback = previous.get(definition.id)?.loaded
                    if (!fallback) continue
                    const restored = yield* load(fallback.plugin)
                    if (restored.scope !== undefined) {
                      active.set(definition.id, {
                        plugin: definition,
                        loaded: { plugin: fallback.plugin, scope: restored.scope },
                        error: loaded.error,
                      })
                      continue
                    }
                    yield* Effect.logError("failed to restore plugin; deactivating", {
                      "plugin.id": definition.id,
                    })
                  }

                  inventory = [...Array.from(active.values()).map(slotInfo), ...failures]
                }),
              )
              yield* bus.publish(Plugin.Event.Updated, {})
            }),
          ),
        (release) => release,
      )
    })

    yield* Queue.take(quarantines).pipe(
      Effect.flatMap((item) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("quarantined plugin after transform failure", {
            "plugin.id": item.plugin.id,
            state: item.failure.state,
            ref: item.ref,
            cause: Cause.die(item.failure.cause),
          })
          yield* lock.withPermit(
            Effect.gen(function* () {
              if (closed) return
              const id = Plugin.ID.make(item.plugin.id)
              const slot = active.get(id)
              // A queued failure from an old generation must never disable its replacement.
              if (slot?.loaded?.scope === item.scope)
                active.set(id, { plugin: slot.plugin, error: item.error, ref: item.ref })
              inventory = [...Array.from(active.values()).map(slotInfo), ...discovered]
              const refreshed = yield* State.batch(item.refresh).pipe(Effect.exit)
              yield* bus.publish(Plugin.Event.Updated, {})
              if (Exit.isFailure(refreshed))
                yield* Effect.logWarning("failed to refresh state after plugin quarantine", {
                  "plugin.id": item.plugin.id,
                  ref: item.ref,
                  cause: refreshed.cause,
                })
            }),
          )
        }).pipe(
          // Cleanup must also be scheduled if an inventory observer fails. User finalizers
          // may await readiness, so never join them under the activation lock or readiness hold.
          Effect.ensuring(
            Scope.close(item.scope, Exit.void).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to clean up quarantined plugin", {
                  "plugin.id": item.plugin.id,
                  ref: item.ref,
                  cause,
                }),
              ),
              Effect.forkScoped({ startImmediately: true }),
            ),
          ),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) =>
              Effect.logError("failed to report quarantined plugin", {
                "plugin.id": item.plugin.id,
                ref: item.ref,
                cause,
              }),
          ),
          Effect.ensuring(item.release),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )

    const close = (exit: Exit.Exit<unknown, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          closed = true
          pending.clear()
          ready.openUnsafe()
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

// `plugin` is the definition the slot was last asked to run; `loaded` is the generation actually
// running, which stays an older fallback while the requested revision keeps failing setup.
type Slot = {
  readonly plugin: Generation
  readonly loaded?: { readonly plugin: Generation; readonly scope: Scope.Closeable }
  readonly error?: string
  readonly ref?: string
}

type Quarantine = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  readonly failure: State.Failure
  readonly refresh: Effect.Effect<void>
  readonly error: string
  readonly ref: string
  readonly release: Effect.Effect<void>
}

function slotInfo(slot: Slot): Plugin.Info {
  return {
    id: Plugin.ID.make(slot.plugin.id),
    source: slot.plugin.source ?? { type: "builtin" },
    state: slot.error === undefined ? { status: "active" } : { status: "failed", error: slot.error, ref: slot.ref },
    features: { server: true, ...slot.plugin.features },
  }
}

export const node: LayerNode.Provider<Service, PersistentPty.UnavailableError, typeof Node.tags.values.location> =
  Node.makeLocationNode({
    service: Service,
    layer,
    deps: [PluginHost.requirements],
  })
