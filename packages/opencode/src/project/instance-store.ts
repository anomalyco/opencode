import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode, Node } from "@opencode-ai/core/effect/app-node"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceBootstrap } from "./bootstrap-service"
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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

/**
 * A directory-global teardown in flight. Every cached entry carries one; an uncached `dispose`
 * creates a standalone tracker so a concurrent `reload` still serializes with its disposers
 * (NEW-V13-06).
 */
interface TeardownTracker {
  /**
   * Resolves when the directory-global `runDisposers` settles, even if the teardown fiber was
   * interrupted while it was in flight.
   */
  readonly teardown: Deferred.Deferred<void>
  /** Whether the teardown reached `runDisposers`, so `teardown` settles on its own. */
  teardownStarted: boolean
}

interface Entry extends TeardownTracker {
  readonly deferred: Deferred.Deferred<InstanceContext>
  /** Outstanding `provide` leases; a leased entry is never evicted (D-P1-05). */
  uses: number
  /** Set synchronously once a teardown claims the entry; a `provide` that observes it reloads. */
  disposed: boolean
  /** Resolves when a claimed teardown finished and the entry left the cache. */
  readonly closed: Deferred.Deferred<void>
}

const makeEntry = (): Entry => ({
  deferred: Deferred.makeUnsafe<InstanceContext>(),
  uses: 0,
  disposed: false,
  closed: Deferred.makeUnsafe<void>(),
  teardown: Deferred.makeUnsafe<void>(),
  teardownStarted: false,
})

const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    // Every cached instance pins its bootstrap resources (LSP clients, PTYs, watchers,
    // file-search index), so the cache is bounded and evicts the oldest done entry.
    const MAX_CACHED_INSTANCES = 16
    const cache = new Map<string, Entry>()
    // Disposers are directory-global and keep running after an interrupt, even though the
    // interrupted entry has already left `cache`. Track those in-flight teardowns by directory
    // so a `reload` can wait for them before booting a replacement (NEW-V12-06). Trackers can
    // outlive their entry (uncached `dispose`), so the set holds trackers, not entries.
    const teardowns = new Map<string, Set<TeardownTracker>>()

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

    // Explicit lifecycle ops must not tear down resources an active `provide` lease is
    // using. Wait (bounded) for the lease to drain; after the timeout an operator-explicit
    // teardown proceeds and logs, so a stuck lease can never deadlock disposal (v8 NEW-05).
    const LEASE_DRAIN_TIMEOUT_MS = 2_000
    const awaitLease = (entry: Entry) =>
      Effect.gen(function* () {
        const deadline = Date.now() + LEASE_DRAIN_TIMEOUT_MS
        while (entry.uses > 0 && Date.now() < deadline) yield* Effect.sleep("10 millis")
        if (entry.uses > 0) yield* Effect.logWarning("instance lease did not drain before disposal", { uses: entry.uses })
      })

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

    const disposeContext = Effect.fn("InstanceStore.disposeContext")(function* (ctx: InstanceContext, entry?: Entry) {
      yield* Effect.logInfo("disposing instance", { directory: ctx.directory })
      // Track every directory-global teardown, including one started for a context that was never
      // cached (`dispose` on a foreign context), so a concurrent `reload` cannot boot a
      // replacement while its disposers still run (NEW-V13-06).
      const tracker: TeardownTracker = entry ?? { teardown: Deferred.makeUnsafe<void>(), teardownStarted: false }
      const teardown = yield* Effect.sync(() => {
        const promise = runDisposers(ctx.directory)
        tracker.teardownStarted = true
        const pending = teardowns.get(ctx.directory) ?? new Set<TeardownTracker>()
        pending.add(tracker)
        teardowns.set(ctx.directory, pending)
        const settle = () => {
          const active = teardowns.get(ctx.directory)
          if (active) {
            active.delete(tracker)
            if (active.size === 0) teardowns.delete(ctx.directory)
          }
          Deferred.doneUnsafe(tracker.teardown, Effect.void)
        }
        promise.then(settle, settle)
        return promise
      })
      yield* Effect.promise(() => teardown)
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    // Bounded so a disposer that never settles cannot wedge the directory forever
    // (REGRESSION-V13-01): past the bound the replacement boots anyway and the deviation is
    // logged. The normal interrupted-teardown path still waits for the real disposers
    // (NEW-V12-06). `load`/`provide` stay ungated on purpose (REGRESSION-2 fast-alive).
    const TEARDOWN_DRAIN_TIMEOUT_MS = 2_000
    const awaitTeardowns = (directory: string) =>
      Effect.gen(function* () {
        const deadline = Date.now() + TEARDOWN_DRAIN_TIMEOUT_MS
        while (teardowns.has(directory)) {
          const pending = [...(teardowns.get(directory) ?? [])]
          if (pending.length === 0) return
          const settled = yield* Effect.forEach(pending, (tracker) => Deferred.isDone(tracker.teardown))
          if (settled.every(Boolean)) return
          if (Date.now() >= deadline) {
            yield* Effect.logWarning("instance teardown did not settle before reload", { directory: directory })
            return
          }
          yield* Effect.sleep("25 millis")
        }
      })

    // The reusable branch of `reload` tears the (unclaimed) previous instance down itself, so
    // unlike the interrupted-dispose path there is no `disposeEntry` tracker to observe. Start the
    // directory-global disposers here, register their completion as a tracker, then wait for that
    // tracker with the same bound as `awaitTeardowns`. A never-settling disposer must not wedge
    // `reload`/`provide`/`load` for the directory (NEW-V14-06); past the bound the replacement
    // boots and the deviation is logged, and the still-in-flight run stays visible to a later
    // reload (NEW-V12-06) until it settles.
    const teardownDirectory = (directory: string) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          const tracker: TeardownTracker = { teardown: Deferred.makeUnsafe<void>(), teardownStarted: false }
          const promise = runDisposers(directory)
          tracker.teardownStarted = true
          const pending = teardowns.get(directory) ?? new Set<TeardownTracker>()
          pending.add(tracker)
          teardowns.set(directory, pending)
          const settle = () => {
            const active = teardowns.get(directory)
            if (active) {
              active.delete(tracker)
              if (active.size === 0) teardowns.delete(directory)
            }
            Deferred.doneUnsafe(tracker.teardown, Effect.void)
          }
          promise.then(settle, settle)
        })
        yield* awaitTeardowns(directory)
      })

    // Release a claimed entry: drop it from the cache (only if it is still the cached one, so a
    // reload that already installed a replacement is not clobbered) and resolve `closed` so a
    // `provide` waiting on the claim can reload. Must be uninterruptible: the whole point is that
    // this runs even when the teardown around it is interrupted or times out (REGRESSION-2).
    const releaseClaim = (directory: string, entry: Entry) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          // A claim interrupted before it reached the disposers has no teardown left to wait
          // for; resolve the gate so a reload does not wait on a run that never started.
          if (!entry.teardownStarted) yield* Deferred.succeed(entry.teardown, undefined)
          if (cache.get(directory) === entry) cache.delete(directory)
          yield* Deferred.succeed(entry.closed, undefined)
        }),
      )

    const disposeEntry = Effect.fnUntraced(function* (directory: string, entry: Entry, ctx: InstanceContext) {
      if (cache.get(directory) !== entry) return false
      // Claim the entry in one synchronous step, *before* draining. Setting `disposed` makes
      // `provide`'s check-and-increment and this claim mutually exclusive: whichever runs first
      // is observed by the other, so a `provide` that lands after this point sees `disposed`,
      // waits for `closed`, and reloads rather than leasing the context we are tearing down (W5).
      // Claiming first also means a late `provide` cannot extend the drain below.
      const claimed = yield* Effect.sync(() => {
        if (cache.get(directory) !== entry) return false
        if (entry.disposed) return false
        entry.disposed = true
        return true
      })
      if (!claimed) return false
      // Give an outstanding lease a bounded chance to release, then tear down anyway. The drain
      // deadline exists precisely for leases that will never release on their own — a pending
      // permission/question prompt is itself the lease holder, and disposal must reject it — so
      // an explicit dispose that aborted here would silently strand the prompt (R-V10-01). A
      // stuck lease can never deadlock disposal (v8 NEW-05); the W5 handshake above keeps a
      // provide-after-dispose from ever using the disposed context.
      //
      // The `ensuring` wraps the *whole* post-claim region, not just `disposeContext`: an
      // interrupt or timeout inside `awaitLease` used to skip the finalizer entirely (the claim
      // is synchronous, the finalizer was attached after the drain), leaving `disposed=true`
      // with `closed` pending and the entry cached, so every later `provide` for this directory
      // awaited `closed` forever (REGRESSION-2). The finalizer must always run.
      yield* Effect.gen(function* () {
        yield* awaitLease(entry)
        yield* disposeContext(ctx, entry)
      }).pipe(Effect.ensuring(releaseClaim(directory, entry)))
      return true
    })

    const evictStale = Effect.fnUntraced(function* () {
      for (const [directory, entry] of [...cache.entries()]) {
        if (cache.size < MAX_CACHED_INSTANCES) return
        // An actively-provided instance must never be torn down mid-turn; skipping it
        // can leave the cache temporarily over the bound, which is the safe direction.
        if (entry.uses > 0) continue
        if (!(yield* Deferred.isDone(entry.deferred))) continue
        const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
        if (Exit.isFailure(exit)) yield* removeEntry(directory, entry).pipe(Effect.asVoid)
        else yield* disposeEntry(directory, entry, exit.value).pipe(Effect.asVoid)
      }
    })

    const loadEntry = (input: LoadInput): Effect.Effect<{ ctx: InstanceContext; entry: Entry }> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = cache.get(directory)
          if (existing) {
            cache.delete(directory)
            cache.set(directory, existing)
            return { ctx: yield* restore(Deferred.await(existing.deferred)), entry: existing }
          }

          yield* evictStale()
          const entry = makeEntry()
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("creating instance", { directory: directory })
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return { ctx: yield* restore(Deferred.await(entry.deferred)), entry }
        }),
      )
    }

    const load = (input: LoadInput): Effect.Effect<InstanceContext> =>
      loadEntry(input).pipe(
        Effect.map((loaded) => loaded.ctx),
        Effect.withSpan("InstanceStore.load"),
      )

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previous = cache.get(directory)
          const reusable = previous && !previous.disposed ? previous : undefined
          // A reload for a directory not already cached adds an entry like `load`, so it
          // must enforce the bound too; a replacement keeps the size unchanged.
          if (!reusable) yield* evictStale()
          const entry = makeEntry()
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("reloading instance", { directory: directory })
            if (reusable) {
              yield* Deferred.await(reusable.deferred).pipe(Effect.ignore)
              yield* awaitLease(reusable)
              yield* teardownDirectory(directory)
              yield* emitDisposed({ directory, project: input.project?.id })
            } else if (previous) {
              // The previous entry is already claimed by a draining `disposeEntry`. Its late
              // teardown runs the directory-global disposers, so booting the replacement before
              // it finishes would tear the fresh entry's resources down (NEW-V11-07). `closed`
              // resolves after that teardown (or immediately if it was interrupted), so await it
              // to serialize reload against a claimed entry.
              yield* Deferred.await(previous.closed)
            }
            // An interrupted teardown resolves `closed` immediately while its disposers keep
            // running, and its entry is already gone from the cache, so the check above cannot
            // see it. Wait for every directory-global teardown still in flight before booting
            // the replacement (NEW-V12-06).
            yield* awaitTeardowns(directory)
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

    // Runs entries sequentially: each `disposeEntry` may wait up to LEASE_DRAIN_TIMEOUT_MS for a
    // lease to drain, so the worst case is MAX_CACHED_INSTANCES * 2 s (~32 s) during explicit
    // shutdown. Parallelising would shorten it but changes teardown ordering, so the bound is
    // documented rather than changed here (W5/F4c).
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

    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const loaded = yield* loadEntry(input)
        // A teardown may have claimed this entry between `loadEntry` returning it and the
        // lease increment; wait for that teardown to finish, then load a fresh entry rather
        // than run against a disposed context (W5).
        if (loaded.entry.disposed) {
          yield* Deferred.await(loaded.entry.closed)
          return yield* provide(input, effect)
        }
        // Hold the lease on the exact entry the effect is using, not whatever the cache
        // holds now, so a concurrent reload cannot make the lease land on the wrong entry.
        loaded.entry.uses += 1
        return yield* effect.pipe(
          Effect.provideService(InstanceRef, loaded.ctx),
          Effect.ensuring(
            Effect.sync(() => {
              loaded.entry.uses = Math.max(0, loaded.entry.uses - 1)
            }),
          ),
        )
      })

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load,
      reload,
      dispose,
      disposeDirectory,
      disposeAll,
      provide,
    })
  }),
)

export const bootstrapNode = LayerNode.unbound(InstanceBootstrap.Service, Node.tags.values.global)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Project.node, bootstrapNode],
})

export * as InstanceStore from "./instance-store"
