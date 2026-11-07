export * as Plugin from "./plugin.js"
export { Event, GuiBundle, ID, Info, Source, State } from "@opencode/schema/plugin"

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/schema/plugin"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { PersistentPty } from "./persistent-pty.js"
import { Cause, Context, Effect, Exit, Latch, Layer, Logger, Queue, References, Scope, Semaphore } from "effect"
import { Bus } from "./bus.js"
import { PluginHost } from "./plugin/host.js"
import { type Failure, type Generation, Service } from "./plugin/service.js"
import { State } from "./state.js"

export { awaitActivation, type Failure, type Generation, type Interface, Service } from "./plugin/service.js"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
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
    const snapshot = () => [...Array.from(active.values()).map(slotInfo), ...discovered]
    // A changed `./gui-experimental` bundle alone restarts nothing; its revision is part of what changes, so the event
    // tells the app to reload it.
    const publish = State.changes(
      (items: readonly Plugin.Info[]) => [items, Array.from(active.values(), (entry) => entry.plugin.gui?.revision)],
      () => bus.publish(Plugin.Event.Updated, {}).pipe(Effect.asVoid),
    )
    const list = Effect.fn("Plugin.list")(function* () {
      return inventory
    })
    const gui = Effect.fn("Plugin.gui")(function* (id: Plugin.ID) {
      const gui = active.get(id)?.plugin.gui
      if (!gui) return undefined
      // A plugin that resolved a `./gui-experimental` file but cannot read it now is a server fault, not a missing
      // bundle.
      const code = yield* Effect.promise(() => readFile(fileURLToPath(gui.file), "utf8"))
      return { code, revision: gui.revision, options: gui.options } satisfies Plugin.GuiBundle
    })
    const hostContext = yield* Effect.context<Effect.Services<ReturnType<typeof PluginHost.make>>>()
    // Loads `plugin` into the slot for `requested`. `fallback` is the requested revision's setup error when
    // restoring an older revision.
    const load = Effect.fnUntraced(function* (plugin: Definition, requested: Definition, fallback?: string) {
      const activation: Activation = { plugin, scope: yield* Scope.fork(scope) }
      const inherit = yield* State.inherit()
      let disabled: Disabled | undefined
      const grouped = State.group((failure, refresh) => {
        const next: Disabled = {
          error: `Plugin disabled after ${failure.state}.transform failed. Check server logs for details.`,
          ref: `err_${crypto.randomUUID().slice(0, 8)}`,
        }
        disabled = next
        // Only disable the slot still running this exact activation; a replacement keeps its own state.
        const slot = active.get(plugin.id)
        if ((slot?.status === "active" || slot?.status === "fallback") && slot.activation === activation)
          active.set(plugin.id, { status: "disabled", plugin: slot.plugin, failure: next })
        Queue.offerUnsafe(pendingFailures, {
          plugin,
          scope: activation.scope,
          failure,
          refresh,
          ref: next.ref,
          release: holdUnsafe(),
        })
      })
      const host = yield* PluginHost.make({ list }, plugin.id).pipe(Effect.provideContext(hostContext))
      const exit = yield* Effect.suspend(() => plugin.effect(host)).pipe(
        grouped,
        inherit,
        Effect.updateContext((context: Context.Context<never>) =>
          Context.make(Scope.Scope, activation.scope).pipe(
            Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
            Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
          ),
        ),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !disabled ? Scope.close(activation.scope, exit) : Effect.void,
        ),
        Effect.exit,
      )
      // Store the slot in the same synchronous step that reads `disabled`; later failures find it in `active`.
      const slot: Slot = disabled
        ? { status: "disabled", plugin: requested, failure: disabled }
        : Exit.isFailure(exit)
          ? { status: "setup-failed", plugin: requested, error: fallback ?? Cause.pretty(exit.cause) }
          : fallback === undefined
            ? { status: "active", plugin: requested, activation }
            : { status: "fallback", plugin: requested, activation, error: fallback }
      active.set(requested.id, slot)
      if (Exit.isFailure(exit) && !disabled)
        yield* Effect.logWarning("failed to load plugin", {
          "plugin.id": plugin.id,
          cause: exit.cause,
        })
      return slot
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
                inventory = snapshot()
                yield* publish(inventory)
                return
              }

              yield* State.batch(
                Effect.gen(function* () {
                  // Registrations are ordered by setup, so only the unchanged prefix can stay alive.
                  const previous = new Map<Plugin.ID, Slot>()
                  yield* Effect.forEach(
                    Array.from(active.keys()).slice(prefix).toReversed(),
                    (id) =>
                      Effect.gen(function* () {
                        const slot = active.get(id)
                        if (slot?.status === "active" || slot?.status === "fallback")
                          yield* Scope.close(slot.activation.scope, Exit.void)
                        // Read again after closing: a transform can fail while its own scope closes.
                        const closed = active.get(id)
                        if (closed) previous.set(id, closed)
                        active.delete(id)
                      }),
                    { discard: true },
                  )
                  for (const definition of definitions.slice(prefix)) {
                    const slot = previous.get(definition.id)
                    // Reordering healthy registrations does not authorize retrying a failed revision.
                    if (slot?.status === "disabled" && slot.plugin.revision === definition.revision) {
                      active.set(definition.id, { ...slot, plugin: definition })
                      continue
                    }
                    const result = yield* load(definition, definition)
                    if (result.status !== "setup-failed") continue
                    if (slot?.status !== "active" && slot?.status !== "fallback") continue
                    const restored = yield* load(slot.activation.plugin, definition, result.error)
                    if (restored.status !== "setup-failed") continue
                    yield* Effect.logError("failed to restore plugin; deactivating", {
                      "plugin.id": definition.id,
                    })
                  }

                  inventory = snapshot()
                }),
              )
              yield* publish(inventory)
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
              // Failure is already recorded on the slot running its exact activation, so an old
              // queued item cannot disable a replacement and teardown need not wait for this worker.
              inventory = snapshot()
              const refreshed = yield* State.batch(item.refresh).pipe(Effect.exit)
              yield* publish(inventory)
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
      gui,
    })
  }),
)

type Definition = Generation & { readonly id: Plugin.ID }

// `plugin` is the requested definition. A fallback keeps an older activation running while the
// requested revision keeps failing setup; a disabled slot's transform failed and its scope now
// belongs to the failure worker.
type Slot = { readonly plugin: Definition } & (
  | { readonly status: "active"; readonly activation: Activation }
  | { readonly status: "fallback"; readonly activation: Activation; readonly error: string }
  | { readonly status: "setup-failed"; readonly error: string }
  | { readonly status: "disabled"; readonly failure: Disabled }
)

type Activation = {
  readonly plugin: Definition
  readonly scope: Scope.Closeable
}

type Disabled = { readonly error: string; readonly ref: string }

type PendingFailure = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  readonly failure: State.Failure
  readonly refresh: Effect.Effect<void>
  readonly ref: string
  readonly release: Effect.Effect<void>
}

function slotInfo(slot: Slot): Plugin.Info {
  return {
    id: slot.plugin.id,
    source: slot.plugin.source ?? { type: "builtin" },
    state:
      slot.status === "active"
        ? { status: "active" }
        : { status: "failed", ...(slot.status === "disabled" ? slot.failure : { error: slot.error }) },
    // Built-in and SDK plugins are server parts; a package lists its own parts.
    features: slot.plugin.features ?? { server: true },
  }
}

export const node: LayerNode.Provider<Service, PersistentPty.UnavailableError, typeof Node.tags.values.location> =
  Node.makeLocationNode({
    service: Service,
    layer,
    deps: [PluginHost.requirements],
  })
