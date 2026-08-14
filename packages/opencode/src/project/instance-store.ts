import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode, Node } from "@opencode-ai/core/effect/app-node"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceActivity } from "@opencode-ai/core/instance-activity"
import { Clock, Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceBootstrap } from "./bootstrap-service"
import * as Project from "./project"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
}

export interface SweepIdleInput<E, R> {
  readonly idleTimeoutMs: number
  readonly canDispose: (ctx: InstanceContext) => Effect.Effect<boolean, E, R>
}

export interface Interface {
  readonly load: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly reload: (input: LoadInput) => Effect.Effect<InstanceContext>
  readonly dispose: (ctx: InstanceContext) => Effect.Effect<void>
  readonly disposeDirectory: (directory: string) => Effect.Effect<void>
  readonly disposeAll: () => Effect.Effect<void>
  readonly sweepIdle: <E, R>(input: SweepIdleInput<E, R>) => Effect.Effect<number, E, R>
  readonly provide: <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

interface ActiveEntry {
  readonly state: "active"
  readonly deferred: Deferred.Deferred<InstanceContext>
  active: number
  inactive: Deferred.Deferred<void> | undefined
  lastUsed: number
  readonly activity: InstanceActivity.Identity
  activityGeneration: number
}

interface Lease {
  readonly directory: string
  readonly entry: ActiveEntry
  active: boolean
}

const CurrentLeases = Context.Reference<readonly Lease[]>("~opencode/InstanceStore/CurrentLeases", {
  defaultValue: () => [],
})

interface DisposingEntry {
  readonly state: "disposing"
  readonly done: Deferred.Deferred<void>
  readonly activity: InstanceActivity.Identity
}

type Entry = ActiveEntry | DisposingEntry

interface DirectoryKey {
  readonly lexical: string
  readonly directory: string
}

interface AliasEntry {
  readonly directory: string
  pending: number
}

const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()
    const aliases = new Map<string, AliasEntry>()

    const directoryKey = (input: string): DirectoryKey => {
      const lexical = InstanceActivity.identify(input).directory
      const remembered = aliases.get(lexical)
      if (remembered && (remembered.pending > 0 || cache.has(remembered.directory))) {
        return { lexical, directory: remembered.directory }
      }
      if (remembered) aliases.delete(lexical)
      const directory = cache.has(lexical) ? lexical : FSUtil.resolve(input)
      return { lexical, directory }
    }

    const reserveDirectory = (input: string) => {
      const key = directoryKey(input)
      const remembered = aliases.get(key.lexical)
      if (remembered?.directory === key.directory) remembered.pending++
      else aliases.set(key.lexical, { directory: key.directory, pending: 1 })
      return key
    }

    const releaseDirectory = (key: DirectoryKey) => {
      const remembered = aliases.get(key.lexical)
      if (remembered?.directory !== key.directory) return
      remembered.pending--
      if (remembered.pending === 0 && !cache.has(key.directory)) aliases.delete(key.lexical)
    }

    const clearAliases = (directory: string) => {
      for (const [alias, target] of aliases) {
        if (target.directory === directory && target.pending === 0) aliases.delete(alias)
      }
    }

    const withReservedDirectory = <A, E, R>(
      input: string,
      use: (key: DirectoryKey) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => reserveDirectory(input)),
        use,
        (key) => Effect.sync(() => releaseDirectory(key)),
      )

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
        clearAliases(directory)
        return true
      })

    const completeLoad = (directory: string, input: LoadInput, entry: ActiveEntry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory }))
        if (Exit.isFailure(exit)) yield* removeEntry(directory, entry)
        yield* Deferred.done(entry.deferred, exit).pipe(Effect.asVoid)
      })

    const startLoad = (directory: string, input: LoadInput, now: number, active = 0) => {
      const activity = InstanceActivity.identify(directory)
      const entry: ActiveEntry = {
        state: "active",
        deferred: Deferred.makeUnsafe<InstanceContext>(),
        active,
        inactive: active > 0 ? Deferred.makeUnsafe<void>() : undefined,
        lastUsed: now,
        activity,
        activityGeneration: InstanceActivity.snapshot(activity).generation,
      }
      cache.set(directory, entry)
      return Effect.gen(function* () {
        yield* Effect.logInfo("creating instance", { directory })
        yield* completeLoad(directory, input, entry)
      }).pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.as(entry))
    }

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

    const touch = (entry: ActiveEntry, now: number) => {
      entry.lastUsed = now
      entry.activityGeneration = InstanceActivity.snapshot(entry.activity).generation
    }

    const releaseLease = (lease: Lease) =>
      Effect.gen(function* () {
        if (!lease.active) return
        lease.active = false
        lease.entry.active--
        touch(lease.entry, yield* Clock.currentTimeMillis)
        if (lease.entry.active !== 0) return
        const inactive = lease.entry.inactive
        lease.entry.inactive = undefined
        if (inactive) yield* Deferred.succeed(inactive, undefined)
      })

    const releaseOwnedLeases = (directory: string, entry: ActiveEntry) =>
      Effect.gen(function* () {
        const leases = yield* CurrentLeases
        yield* Effect.forEach(
          leases,
          (lease) =>
            lease.directory === directory && lease.entry === entry && lease.active ? releaseLease(lease) : Effect.void,
          { discard: true },
        )
      })

    const claim = (directory: string, expected: ActiveEntry | undefined, validate: () => boolean = () => true) =>
      Effect.sync(() => {
        if (cache.get(directory) !== expected) return undefined
        if (expected && expected.active > 0) return undefined
        if (!validate()) return undefined
        const tombstone: DisposingEntry = {
          state: "disposing",
          done: Deferred.makeUnsafe<void>(),
          activity: expected?.activity ?? InstanceActivity.identify(directory),
        }
        cache.set(directory, tombstone)
        return tombstone
      })

    const finishTombstone = (directory: string, tombstone: DisposingEntry) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          if (cache.get(directory) !== tombstone) return
          cache.delete(directory)
          clearAliases(directory)
        })
        yield* Deferred.succeed(tombstone.done, undefined).pipe(Effect.asVoid)
      })

    const disposeClaimed = (directory: string, tombstone: DisposingEntry, ctx: InstanceContext) =>
      disposeContext(ctx).pipe(
        Effect.ensuring(Effect.sync(() => InstanceActivity.forget(tombstone.activity))),
        Effect.ensuring(finishTombstone(directory, tombstone)),
        Effect.uninterruptible,
      )

    const claimAndDispose = (
      directory: string,
      expected: ActiveEntry | undefined,
      ctx: InstanceContext,
      validate?: () => boolean,
    ) =>
      Effect.gen(function* () {
        const tombstone = yield* claim(directory, expected, validate)
        if (!tombstone) return false
        yield* disposeClaimed(directory, tombstone, ctx)
        return true
      }).pipe(Effect.uninterruptible)

    const waitForInactive = (directory: string, entry: ActiveEntry): Effect.Effect<boolean> =>
      Effect.suspend(() => {
        if (cache.get(directory) !== entry) return Effect.succeed(false)
        if (entry.active === 0) return Effect.succeed(true)
        return Deferred.await(entry.inactive!).pipe(Effect.andThen(waitForInactive(directory, entry)))
      })

    const disposeWhenInactive = (directory: string, entry: ActiveEntry, ctx: InstanceContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!(yield* waitForInactive(directory, entry))) return
        if (yield* claimAndDispose(directory, entry, ctx)) return
        if (cache.get(directory) !== entry) return
        yield* disposeWhenInactive(directory, entry, ctx)
      })

    const loadFrozen = (key: DirectoryKey, input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = key.directory
      const loop = (): Effect.Effect<InstanceContext> =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const existing = cache.get(directory)
            if (existing?.state === "disposing") {
              yield* restore(Deferred.await(existing.done))
              return yield* restore(loop())
            }
            const now = yield* Clock.currentTimeMillis
            if (existing) {
              touch(existing, now)
              return yield* restore(Deferred.await(existing.deferred))
            }
            const entry = yield* startLoad(directory, input, now)
            return yield* restore(Deferred.await(entry.deferred))
          }),
        )
      return loop().pipe(Effect.withSpan("InstanceStore.load"))
    }

    const load = (input: LoadInput): Effect.Effect<InstanceContext> =>
      withReservedDirectory(input.directory, (key) => loadFrozen(key, input))

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> =>
      withReservedDirectory(input.directory, (key) => {
        const directory = key.directory
        const loop = (): Effect.Effect<InstanceContext> =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const previous = cache.get(directory)
              if (previous?.state === "disposing") {
                yield* restore(Deferred.await(previous.done))
                return yield* restore(loop())
              }
              if (!previous) return yield* restore(loadFrozen(key, { ...input, directory }))

              const exit = yield* restore(Deferred.await(previous.deferred).pipe(Effect.exit))
              if (Exit.isFailure(exit)) {
                yield* removeEntry(directory, previous)
                return yield* restore(loop())
              }
              yield* releaseOwnedLeases(directory, previous)
              if (!(yield* restore(waitForInactive(directory, previous)))) return yield* restore(loop())
              const tombstone = yield* claim(directory, previous)
              if (!tombstone) return yield* restore(loop())

              const entry = yield* Effect.gen(function* () {
                yield* disposeContext(exit.value).pipe(
                  Effect.ensuring(Effect.sync(() => InstanceActivity.forget(tombstone.activity))),
                )
                const now = yield* Clock.currentTimeMillis
                return yield* startLoad(directory, input, now)
              }).pipe(Effect.ensuring(finishTombstone(directory, tombstone)))
              return yield* restore(Deferred.await(entry.deferred))
            }),
          )
        return Effect.logInfo("reloading instance", { directory }).pipe(
          Effect.flatMap(loop),
          Effect.withSpan("InstanceStore.reload"),
        )
      })

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext) {
      const directory = directoryKey(ctx.directory).directory
      const entry = cache.get(directory)
      if (entry?.state === "disposing") {
        yield* Deferred.await(entry.done)
        return undefined
      }
      if (!entry) {
        yield* claimAndDispose(directory, undefined, ctx)
        return undefined
      }

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        yield* removeEntry(directory, entry)
        return undefined
      }
      if (exit.value !== ctx) return undefined
      yield* releaseOwnedLeases(directory, entry)
      yield* disposeWhenInactive(directory, entry, ctx)
      return undefined
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string) {
      const directory = directoryKey(input).directory
      const entry = cache.get(directory)
      if (!entry) return undefined
      if (entry.state === "disposing") {
        yield* Deferred.await(entry.done)
        return undefined
      }
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        yield* removeEntry(directory, entry)
        return undefined
      }
      yield* releaseOwnedLeases(directory, entry)
      yield* disposeWhenInactive(directory, entry, exit.value)
      return undefined
    })

    const disposeAllOnce = Effect.fnUntraced(function* () {
      yield* Effect.logInfo("disposing all instances")
      yield* Effect.forEach(
        [...cache.entries()],
        ([directory, entry]) =>
          Effect.gen(function* () {
            if (entry.state === "disposing") {
              yield* Deferred.await(entry.done)
              return undefined
            }
            const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              yield* Effect.logWarning("instance dispose failed", { key: directory, cause: exit.cause })
              yield* removeEntry(directory, entry)
              return undefined
            }
            yield* disposeWhenInactive(directory, entry, exit.value)
            return undefined
          }),
        { discard: true },
      )
    })

    const cachedDisposeAll = yield* Effect.cachedWithTTL(disposeAllOnce(), Duration.zero)
    const disposeAll = Effect.fn("InstanceStore.disposeAll")(function* () {
      const leases = yield* CurrentLeases
      yield* Effect.forEach(leases, (lease) => (lease.active ? releaseLease(lease) : Effect.void), { discard: true })
      return yield* cachedDisposeAll
    })

    const sweepIdle = Effect.fn("InstanceStore.sweepIdle")(function* <E, R>(input: SweepIdleInput<E, R>) {
      const cutoff = (yield* Clock.currentTimeMillis) - input.idleTimeoutMs
      const candidates = [...cache.entries()].filter(
        (item): item is [string, ActiveEntry] =>
          item[1].state === "active" && item[1].active === 0 && item[1].lastUsed <= cutoff,
      )
      const results = yield* Effect.forEach(candidates, ([directory, entry]) =>
        Effect.gen(function* () {
          const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
          if (Exit.isFailure(exit)) {
            yield* removeEntry(directory, entry)
            return false
          }
          const activity = InstanceActivity.snapshot(entry.activity)
          if (activity.generation !== entry.activityGeneration) {
            touch(entry, yield* Clock.currentTimeMillis)
            return false
          }
          const allowed = yield* input.canDispose(exit.value)
          if (cache.get(directory) !== entry || entry.active !== 0 || entry.lastUsed > cutoff) return false
          if (!allowed) {
            touch(entry, yield* Clock.currentTimeMillis)
            return false
          }
          return yield* claimAndDispose(directory, entry, exit.value, () => InstanceActivity.isCurrentAndIdle(activity))
        }),
      )
      return results.filter(Boolean).length
    })

    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      withReservedDirectory(input.directory, (key) => {
        const directory = key.directory
        return Effect.uninterruptibleMask((restore) => {
          const acquire = (): Effect.Effect<ActiveEntry> =>
            Effect.gen(function* () {
              const existing = cache.get(directory)
              if (existing?.state === "disposing") {
                yield* restore(Deferred.await(existing.done))
                return yield* acquire()
              }
              const now = yield* Clock.currentTimeMillis
              if (existing) {
                if (existing.active === 0) existing.inactive = Deferred.makeUnsafe<void>()
                existing.active++
                touch(existing, now)
                return existing
              }
              return yield* startLoad(directory, input, now, 1)
            })

          return Effect.gen(function* () {
            const entry = yield* acquire()
            const lease: Lease = { directory, entry, active: true }
            const leases = yield* CurrentLeases
            return yield* restore(
              Deferred.await(entry.deferred).pipe(
                Effect.flatMap((ctx) =>
                  effect.pipe(
                    Effect.provideService(InstanceRef, ctx),
                    Effect.provideService(CurrentLeases, [...leases, lease]),
                  ),
                ),
              ),
            ).pipe(Effect.ensuring(releaseLease(lease)))
          })
        }).pipe(Effect.withSpan("InstanceStore.provide"))
      })

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load,
      reload,
      dispose,
      disposeDirectory,
      disposeAll,
      sweepIdle,
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
