import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceBootstrap } from "./bootstrap-service"
import { InstanceBootstrap as InstanceBootstrapGraph } from "./bootstrap"
import * as Project from "./project"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
}

export interface Interface {
  readonly load: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly reload: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly dispose: (ctx: InstanceContext) => Effect.Effect<void>
  readonly disposeDirectory: (directory: string) => Effect.Effect<void>
  readonly disposeAll: () => Effect.Effect<void>
  readonly provide: <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Mark an instance as in-use (pins it against idle eviction) and refresh its lastUsed. */
  readonly acquire: (directory: string) => Effect.Effect<void>
  /** Release an in-use mark and refresh lastUsed. Pair with acquire via ensuring. */
  readonly release: (directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

interface Entry {
  readonly deferred: Deferred.Deferred<InstanceContext>
  /** Epoch ms of the last time this instance was loaded/acquired/released. */
  lastUsed: number
  /** Count of in-flight requests holding this instance (pins it against eviction). */
  active: number
}

// Idle-instance eviction (opt-in). Without it, the per-directory instance cache grows
// unbounded for long-running `serve` processes that see many distinct directories (e.g.
// one directory per session): every instance keeps file watchers, LSP/MCP subprocesses,
// plugins and bus subscriptions alive forever. Resolved from Flag inside the layer so the
// defaults stay 0 (disabled) and tests can set the env at runtime.
//   OPENCODE_INSTANCE_IDLE_TTL_MS  dispose instances idle (active==0) longer than this
//   OPENCODE_INSTANCE_MAX          LRU cap on live instances (idle ones evicted oldest-first)
//   OPENCODE_INSTANCE_SWEEP_MS     sweep interval (defaults to a third of the TTL)
const sweepInterval = (idleTtlMs: number) =>
  Flag.OPENCODE_INSTANCE_SWEEP_MS ||
  Math.max(1000, Math.min(idleTtlMs > 0 ? Math.floor(idleTtlMs / 3) : 15000, 30000))

export const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()

    const boot = (input: LoadInput & { directory: string }) =>
      Effect.gen(function* () {
        const ctx: InstanceContext =
          input.project && input.worktree
            ? {
                directory: input.directory,
                worktree: input.worktree,
                project: input.project,
              }
            : yield* project.fromDirectory(input.directory).pipe(
                Effect.map((result) => ({
                  directory: input.directory,
                  worktree: result.sandbox,
                  project: result.project,
                })),
              )
        yield* bootstrap.run.pipe(Effect.provideService(InstanceRef, ctx))
        return ctx
      }).pipe(Effect.withSpan("InstanceStore.boot"))

    const removeEntry = (directory: string, entry: Entry) =>
      Effect.sync(() => {
        if (cache.get(directory) !== entry) return false
        cache.delete(directory)
        return true
      })

    const completeLoad = (directory: string, input: LoadInput, entry: Entry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory }))
        if (Exit.isFailure(exit)) yield* removeEntry(directory, entry)
        yield* Deferred.done(entry.deferred, exit).pipe(Effect.asVoid)
      })

    const emitDisposed = (input: { directory: string; project?: string }) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: input.directory,
          project: input.project,
          workspace: WorkspaceContext.workspaceID,
          payload: {
            type: "server.instance.disposed",
            properties: {
              directory: input.directory,
            },
          },
        }),
      )

    const disposeContext = Effect.fn("InstanceStore.disposeContext")(function* (ctx: InstanceContext) {
      yield* Effect.logInfo("disposing instance", { directory: ctx.directory })
      yield* Effect.promise(() => runDisposers(ctx.directory))
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    const disposeEntry = Effect.fnUntraced(function* (directory: string, entry: Entry, ctx: InstanceContext) {
      if (cache.get(directory) !== entry) return false
      yield* disposeContext(ctx)
      if (cache.get(directory) !== entry) return false
      cache.delete(directory)
      return true
    })

    const load = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = cache.get(directory)
          if (existing) {
            existing.lastUsed = Date.now()
            return yield* restore(Deferred.await(existing.deferred))
          }

          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), lastUsed: Date.now(), active: 0 }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("creating instance", { directory: directory })
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred))
        }),
      ).pipe(Effect.withSpan("InstanceStore.load"))
    }

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previous = cache.get(directory)
          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), lastUsed: Date.now(), active: 0 }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("reloading instance", { directory: directory })
            if (previous) {
              yield* Deferred.await(previous.deferred).pipe(Effect.ignore)
              yield* Effect.promise(() => runDisposers(directory))
              yield* emitDisposed({ directory, project: input.project?.id })
            }
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred))
        }),
      ).pipe(Effect.withSpan("InstanceStore.reload"))
    }

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext) {
      const entry = cache.get(ctx.directory)
      if (!entry) return yield* disposeContext(ctx)

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(ctx.directory, entry).pipe(Effect.asVoid)
      if (exit.value !== ctx) return
      yield* disposeEntry(ctx.directory, entry, ctx).pipe(Effect.asVoid)
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string) {
      const directory = FSUtil.resolve(input)
      const entry = cache.get(directory)
      if (!entry) return
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(directory, entry).pipe(Effect.asVoid)
      yield* disposeEntry(directory, entry, exit.value).pipe(Effect.asVoid)
    })

    const disposeAllOnce = Effect.fnUntraced(function* () {
      yield* Effect.logInfo("disposing all instances")
      yield* Effect.forEach(
        [...cache.entries()],
        (item) =>
          Effect.gen(function* () {
            const exit = yield* Deferred.await(item[1].deferred).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              yield* Effect.logWarning("instance dispose failed", { key: item[0], cause: exit.cause })
              yield* removeEntry(item[0], item[1])
              return
            }
            yield* disposeEntry(item[0], item[1], exit.value)
          }),
        { discard: true },
      )
    })

    const cachedDisposeAll = yield* Effect.cachedWithTTL(disposeAllOnce(), Duration.zero)
    const disposeAll = Effect.fn("InstanceStore.disposeAll")(function* () {
      return yield* cachedDisposeAll
    })

    const acquire = (input: string) =>
      Effect.sync(() => {
        const entry = cache.get(FSUtil.resolve(input))
        if (entry) {
          entry.active++
          entry.lastUsed = Date.now()
        }
      })

    const release = (input: string) =>
      Effect.sync(() => {
        const entry = cache.get(FSUtil.resolve(input))
        if (entry) {
          entry.active = Math.max(0, entry.active - 1)
          entry.lastUsed = Date.now()
        }
      })

    // Dispose one cached entry from the sweeper (mirrors disposeDirectory but for a known entry).
    const evictEntry = Effect.fnUntraced(function* (directory: string, entry: Entry) {
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        yield* removeEntry(directory, entry)
        return
      }
      yield* disposeEntry(directory, entry, exit.value).pipe(Effect.asVoid)
    })

    const idleTtlMs = Flag.OPENCODE_INSTANCE_IDLE_TTL_MS
    const maxInstances = Flag.OPENCODE_INSTANCE_MAX

    const sweepOnce = Effect.fnUntraced(function* () {
      const now = Date.now()
      if (idleTtlMs > 0) {
        for (const [directory, entry] of [...cache.entries()]) {
          if (entry.active > 0) continue
          if (now - entry.lastUsed < idleTtlMs) continue
          yield* Effect.logInfo("evicting idle instance", { directory, idleMs: now - entry.lastUsed })
          yield* evictEntry(directory, entry)
        }
      }
      if (maxInstances > 0 && cache.size > maxInstances) {
        const victims = [...cache.entries()]
          .filter(([, entry]) => entry.active <= 0)
          .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
          .slice(0, cache.size - maxInstances)
        for (const [directory, entry] of victims) {
          yield* Effect.logInfo("evicting LRU instance over cap", { directory, size: cache.size, max: maxInstances })
          yield* evictEntry(directory, entry)
        }
      }
    })

    if (idleTtlMs > 0 || maxInstances > 0) {
      const sweepMs = sweepInterval(idleTtlMs)
      yield* Effect.logInfo("instance eviction enabled", { idleTtlMs, maxInstances, sweepMs })
      yield* sweepOnce()
        .pipe(
          Effect.catchCause((cause) => Effect.logWarning("instance sweep failed", { cause })),
          Effect.delay(Duration.millis(sweepMs)),
          Effect.forever,
        )
        .pipe(Effect.forkIn(scope, { startImmediately: true }))
    }

    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      load(input).pipe(Effect.flatMap((ctx) => effect.pipe(Effect.provideService(InstanceRef, ctx))))

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load,
      reload,
      dispose,
      disposeDirectory,
      disposeAll,
      provide,
      acquire,
      release,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Project.defaultLayer))

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Project.node, InstanceBootstrapGraph.node],
})

export * as InstanceStore from "./instance-store"
