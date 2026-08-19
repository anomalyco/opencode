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
import { InstanceOptions, type Profile } from "./instance-options"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
  profile?: Profile
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

interface Entry {
  readonly deferred: Deferred.Deferred<InstanceContext>
  readonly directory: string
  readonly profile: Profile
}

const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()

    const key = (directory: string, profile: Profile) => `${directory}\0${profile}`

    const boot = (input: LoadInput & { directory: string }) =>
      Effect.gen(function* () {
        const profile = InstanceOptions.resolve(input.profile).profile
        const ctx: InstanceContext =
          input.project && input.worktree
            ? {
                directory: input.directory,
                worktree: input.worktree,
                project: input.project,
                profile,
              }
            : yield* project.fromDirectory(input.directory).pipe(
                Effect.map((result) => ({
                  directory: input.directory,
                  worktree: result.sandbox,
                  project: result.project,
                  profile,
                })),
              )
        yield* bootstrap.run.pipe(Effect.provideService(InstanceRef, ctx))
        return ctx
      }).pipe(Effect.withSpan("InstanceStore.boot"))

    const removeEntry = (cacheKey: string, entry: Entry) =>
      Effect.sync(() => {
        if (cache.get(cacheKey) !== entry) return false
        cache.delete(cacheKey)
        return true
      })

    const completeLoad = (cacheKey: string, input: LoadInput, entry: Entry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory: entry.directory }))
        if (Exit.isFailure(exit)) yield* removeEntry(cacheKey, entry)
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
      yield* Effect.promise(() => runDisposers(ctx))
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    const disposeEntry = Effect.fnUntraced(function* (cacheKey: string, entry: Entry, ctx: InstanceContext) {
      if (cache.get(cacheKey) !== entry) return false
      yield* disposeContext(ctx)
      if (cache.get(cacheKey) !== entry) return false
      cache.delete(cacheKey)
      return true
    })

    const load = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      const profile = InstanceOptions.resolve(input.profile).profile
      const cacheKey = key(directory, profile)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = cache.get(cacheKey)
          if (existing) return yield* restore(Deferred.await(existing.deferred))

          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), directory, profile }
          cache.set(cacheKey, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("creating instance", { directory, profile })
            yield* completeLoad(cacheKey, { ...input, profile }, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred))
        }),
      ).pipe(Effect.withSpan("InstanceStore.load"))
    }

    const reload = (input: LoadInput): Effect.Effect<InstanceContext> => {
      const directory = FSUtil.resolve(input.directory)
      const profile = InstanceOptions.resolve(input.profile).profile
      const cacheKey = key(directory, profile)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previous = cache.get(cacheKey)
          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>(), directory, profile }
          cache.set(cacheKey, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("reloading instance", { directory, profile })
            if (previous) {
              const previousExit = yield* Deferred.await(previous.deferred).pipe(Effect.exit)
              if (Exit.isSuccess(previousExit)) yield* Effect.promise(() => runDisposers(previousExit.value))
              yield* emitDisposed({ directory, project: input.project?.id })
            }
            yield* completeLoad(cacheKey, { ...input, profile }, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(Deferred.await(entry.deferred))
        }),
      ).pipe(Effect.withSpan("InstanceStore.reload"))
    }

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext) {
      const cacheKey = key(ctx.directory, InstanceOptions.resolve(ctx.profile).profile)
      const entry = cache.get(cacheKey)
      if (!entry) return yield* disposeContext(ctx)

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(cacheKey, entry).pipe(Effect.asVoid)
      if (exit.value !== ctx) return
      yield* disposeEntry(cacheKey, entry, ctx).pipe(Effect.asVoid)
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string) {
      const directory = FSUtil.resolve(input)
      yield* Effect.forEach(
        [...cache.entries()].filter((item) => item[1].directory === directory),
        (item) =>
          Deferred.await(item[1].deferred).pipe(
            Effect.exit,
            Effect.flatMap((exit) =>
              Exit.isFailure(exit)
                ? removeEntry(item[0], item[1]).pipe(Effect.asVoid)
                : disposeEntry(item[0], item[1], exit.value).pipe(Effect.asVoid),
            ),
          ),
        { discard: true },
      )
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
