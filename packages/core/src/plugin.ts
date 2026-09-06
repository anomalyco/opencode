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
import { Location } from "./location.js"
import { PluginActivation } from "@opencode-ai/plugin/effect/activation"

export { awaitActivation, type Generation, type Interface, Service } from "./plugin/service.js"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const kv = yield* KV.Service
    const location = yield* Location.Service
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
    const pendingFailures = yield* Queue.unbounded<PendingFailure>()
    let discovered: readonly Failure[] = []
    let inventory: Plugin.Info[] = []
    const list = Effect.fn("Plugin.list")(function* () {
      return inventory
    })
    const host = yield* PluginHost.make({ list })
    const load = Effect.fnUntraced(function* (plugin: Generation) {
      const activation: Activation = { plugin, scope: yield* Scope.fork(scope) }
      const inherit = yield* State.inherit()
      const capability = {
        active: true,
        fiberID: yield* Effect.fiberId,
        token: {},
        directory: location.directory,
        workspaceID: location.workspaceID,
      }
      const grouped = State.group((failure, refresh) => {
        activation.failure = {
          error: `Plugin disabled after ${failure.state}.transform failed. Check server logs for details.`,
          ref: `err_${crypto.randomUUID().slice(0, 8)}`,
        }
        Queue.offerUnsafe(pendingFailures, {
          plugin,
          scope: activation.scope,
          failure,
          refresh,
          ref: activation.failure.ref,
          release: holdUnsafe(),
        })
      })
      const exit = yield* Effect.suspend(() =>
        plugin.effect({ ...host, storage: PluginHost.storage(kv, plugin.id) }),
      ).pipe(
        grouped,
        inherit,
        Effect.updateContext((context: Context.Context<never>) =>
          Context.make(Scope.Scope, activation.scope).pipe(
            Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
            Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
            Context.add(PluginActivation.Current, capability),
          ),
        ),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.ensuring(Effect.sync(() => (capability.active = false))),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !activation.failure ? Scope.close(activation.scope, exit) : Effect.void,
        ),
        Effect.exit,
      )
      if (activation.failure || Exit.isSuccess(exit)) return { activation } as const
      yield* Effect.logWarning("failed to load plugin", {
        "plugin.id": plugin.id,
        cause: exit.cause,
      })
      return { error: Cause.pretty(exit.cause) } as const
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
                        if (slot.activation && !slot.activation.failure)
                          yield* Scope.close(slot.activation.scope, Exit.void)
                      }),
                    { discard: true },
                  )
                  for (const definition of definitions.slice(prefix)) {
                    const slot = previous.get(definition.id)
                    // Reordering healthy registrations does not authorize retrying a failed revision.
                    if (slot?.activation?.failure && slot.plugin.revision === definition.revision) {
                      active.set(definition.id, { ...slot, plugin: definition })
                      continue
                    }
                    const result = yield* load(definition)
                    if (result.activation !== undefined) {
                      active.set(definition.id, {
                        plugin: definition,
                        activation: result.activation,
                      })
                      continue
                    }
                    active.set(definition.id, { plugin: definition, error: result.error })

                    const fallback = slot?.activation
                    if (!fallback || fallback.failure) continue
                    const restored = yield* load(fallback.plugin)
                    if (restored.activation !== undefined) {
                      active.set(definition.id, {
                        plugin: definition,
                        activation: restored.activation,
                        error: result.error,
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

    yield* Queue.take(pendingFailures).pipe(
      Effect.flatMap((item) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("disabled plugin after transform failure", {
            "plugin.id": item.plugin.id,
            state: item.failure.state,
            ref: item.ref,
            cause: Cause.die(item.failure.cause),
          })
          yield* lock.withPermit(
            Effect.gen(function* () {
              if (closed) return
              // Failure is already recorded on its exact activation, so an old queued item
              // cannot disable a replacement and teardown need not wait for this worker.
              inventory = [...Array.from(active.values()).map(slotInfo), ...discovered]
              const refreshed = yield* State.batch(item.refresh).pipe(Effect.exit)
              yield* bus.publish(Plugin.Event.Updated, {})
              if (Exit.isFailure(refreshed))
                yield* Effect.logWarning("failed to refresh state after disabling plugin", {
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
                Effect.logWarning("failed to clean up disabled plugin", {
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
              Effect.logError("failed to report disabled plugin", {
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

// `plugin` is the requested definition; `activation` is its last activation, which may have
// failed or be an older fallback while the requested revision keeps failing setup.
type Slot = {
  readonly plugin: Generation
  readonly activation?: Activation
  readonly error?: string
}

// Share the activation across slot snapshots so teardown sees failures synchronously,
// including failures discovered after activate() has captured its previous slots.
type Activation = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  failure?: { readonly error: string; readonly ref: string }
}

type PendingFailure = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  readonly failure: State.Failure
  readonly refresh: Effect.Effect<void>
  readonly ref: string
  readonly release: Effect.Effect<void>
}

function slotInfo(slot: Slot): Plugin.Info {
  const failure = slot.activation?.failure ?? (slot.error === undefined ? undefined : { error: slot.error })
  return {
    id: Plugin.ID.make(slot.plugin.id),
    source: slot.plugin.source ?? { type: "builtin" },
    state: failure === undefined ? { status: "active" } : { status: "failed", ...failure },
    features: { server: true, ...slot.plugin.features },
  }
}

export const node: LayerNode.Provider<Service, PersistentPty.UnavailableError, typeof Node.tags.values.location> =
  Node.makeLocationNode({
    service: Service,
    layer,
    deps: [PluginHost.requirements],
  })
