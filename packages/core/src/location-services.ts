import {
  Context,
  Deferred,
  Duration,
  Effect,
  Equal,
  Exit,
  Fiber,
  Layer,
  LayerMap,
  MutableHashMap,
  MutableHashSet,
  Option,
  RcMap,
  Scope,
} from "effect"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services

const HELD_WARNING_AFTER = "30 seconds"

/** A cached instance: a Location's default one, or a private one a registered builder keyed within the Location. */
interface Key {
  readonly ref: Location.Ref
  readonly instance: { readonly owner: number; readonly key: string } | undefined
}

/** The default selector: every Session shares its Location's default instance. */
export function selector(locations: LocationServiceMap.Interface) {
  return Instance.Service.of({
    provide: (session) => Effect.provide(locations.get(session.location)),
    live: (session) => locations.has(session.location),
  })
}

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  // Memoized like any other layer, and given the host's memo map so Stage 1 reuses the globals it already built.
  return Layer.fromBuildMemo((memoMap, owner) =>
    Effect.gen(function* () {
      // Forked first so it closes last: every default and private instance shuts down before Stage-1 globals.
      const globalScope = yield* Scope.fork(owner)
      let closed = false
      let deferred: Deferred.Deferred<LayerNode.Host> | undefined
      let buildingFiber: Fiber.Fiber<unknown, unknown> | undefined
      yield* Scope.addFinalizer(
        globalScope,
        Effect.sync(() => {
          closed = true
          if (deferred) Deferred.doneUnsafe(deferred, Exit.interrupt())
        }),
      )
      // Synchronous re-entrancy from the Stage-1 builder fiber would deadlock (including on the same Location ref
      // already in flight in RcMap); concurrent or background fibers can safely wait on the shared Deferred.
      const reentrant = () => buildingFiber !== undefined && Fiber.getCurrent() === buildingFiber
      const reentrantError = () =>
        new Error("A global service booted a Location while its host was still building globals; boot it after startup")
      const host: Effect.Effect<LayerNode.Host> = Effect.suspend(() => {
        if (closed) return Effect.interrupt
        if (deferred) {
          if (reentrant()) return Effect.die(reentrantError())
          return Deferred.await(deferred)
        }
        const pending = Deferred.makeUnsafe<LayerNode.Host>()
        deferred = pending
        const build = Effect.suspend(() => {
          buildingFiber = Fiber.getCurrent()
          return Layer.buildWithMemoMap(
            LayerNode.compile(Instance.globals(stage1), { replacements: stage1 }),
            memoMap,
            globalScope,
          )
        }).pipe(
          // Like a Location's other boot failures, a global that fails to build is a defect.
          Effect.orDie,
          Effect.onExit((exit) =>
            Effect.sync(() => {
              buildingFiber = undefined
              Deferred.doneUnsafe(
                pending,
                Exit.map(exit, (context) => ({ tag: Node.tags.values.global, context, replacements })),
              )
            }),
          ),
        )
        // Fork into globalScope so one cancelled Location boot cannot interrupt the shared Stage-1 build,
        // while closing the host cleanly interrupts it.
        return build.pipe(
          Effect.forkIn(globalScope, { startImmediately: true }),
          Effect.andThen(Deferred.await(pending)),
        )
      })
      // Indexed by a Key's `instance.owner`.
      const privateBuilds: LocationServiceMap.PrivateBuild[] = []
      const boot = (key: Key, resolved: LayerNode.Host) =>
        key.instance
          ? privateBuilds[key.instance.owner](key.ref, key.instance.key, resolved)
          : Instance.layer(key.ref, { host: resolved })
      // Registered when the lookup starts, before any configuration is awaited, so an invalidation that
      // arrives mid-boot detaches it.
      const builds = MutableHashMap.empty<Key, { close?: Effect.Effect<void> }>()
      // Every RcMap entry scope until it closes, including ones invalidation detached while a borrower holds them.
      // Tracking RcMap's own scope (not a child) ensures shutdown also cancels held-warning timers and interrupts
      // detached in-flight builds.
      const live = new Set<Scope.Closeable>()
      const entryScope = (key: Key) => {
        const state = inner.rcMap.state
        return state._tag === "Open" ? Option.getOrUndefined(MutableHashMap.get(state.map, key))?.scope : undefined
      }
      const inner: LayerMap.LayerMap<Key, LocationServices, Instance.Error> = yield* LayerMap.make(
        (key: Key) => {
          const build: { close?: Effect.Effect<void> } = {}
          MutableHashMap.set(builds, key, build)
          const tracked = entryScope(key)
          return Layer.fromBuild((memoMap, scope) =>
            Effect.gen(function* () {
              if (tracked) {
                live.add(tracked)
                yield* Scope.addFinalizer(
                  tracked,
                  Effect.sync(() => live.delete(tracked)),
                )
              }
              return yield* Layer.buildWithMemoMap(boot(key, yield* host), memoMap, scope)
            }).pipe(
              Effect.onExit((exit) => {
                const finish = Effect.suspend(() => {
                  if (Exit.isSuccess(exit)) {
                    return Effect.gen(function* () {
                      const lifecycle = Context.get(exit.value, LocationLifecycle.Service)
                      // A boot detached while in flight still needs shutdown and cancellation.
                      if (Option.getOrUndefined(MutableHashMap.get(builds, key)) !== build)
                        return yield* lifecycle.shutdown
                      build.close = lifecycle.shutdown
                    })
                  }
                  // An explicitly invalidated build must not evict its replacement.
                  if (Option.getOrUndefined(MutableHashMap.get(builds, key)) !== build) return Effect.void
                  MutableHashMap.remove(builds, key)
                  // Evict once per failed build, before its result reaches borrowers.
                  return inner.invalidate(key)
                })
                // With no borrowers, invalidation closes the entry's scope and
                // joins this lookup fiber. Let the owner finish that cleanup.
                return Exit.isFailure(exit)
                  ? finish.pipe(Effect.forkIn(owner, { startImmediately: true }), Effect.asVoid)
                  : finish
              }),
            ),
          )
        },
        // Retain healthy graphs. Boot failures, not local filesystem probes,
        // decide whether a location (including workspace placement) can retry.
        { idleTimeToLive: Duration.infinity },
      )
      // RcMap closes entries one at a time on shutdown, and only the ones it still holds. Close every live
      // instance concurrently first (borrowed and detached ones too); RcMap then finds them closed.
      yield* Effect.addFinalizer(() =>
        Effect.forEach(Array.from(live), (scope) => Effect.exit(Scope.close(scope, Exit.void)), {
          concurrency: "unbounded",
          discard: true,
        }),
      )
      const cached = Effect.map(RcMap.keys(inner.rcMap), (keys) => Array.from(keys))
      const at = (ref: Location.Ref): Key => ({ ref: LocationServiceMap.canonical(ref), instance: undefined })
      const get = (key: Key): Layer.Layer<LocationServices, Instance.Error> =>
        Layer.suspend(() => (reentrant() ? Layer.unwrap(Effect.die(reentrantError())) : inner.get(key)))
      const contextEffect = (key: Key) =>
        Effect.suspend(() => (reentrant() ? Effect.die(reentrantError()) : inner.contextEffect(key)))
      const evict = (key: Key) =>
        Effect.suspend(() => {
          const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
          MutableHashMap.remove(builds, key)
          const state = inner.rcMap.state
          const held = state._tag === "Open" ? Option.getOrUndefined(MutableHashMap.get(state.map, key)) : undefined
          // Detach routing first, then cancel interactions and notify clients. Running
          // steps retain their borrowed graph until they can hand off at a boundary.
          // Do not await a boot here: failed/in-flight builds have their own cleanup path.
          return inner.invalidate(key).pipe(
            Effect.andThen(build?.close ?? Effect.void),
            Effect.andThen(
              // Borrowers release on shutdown; one that does not keeps every service of this Location running.
              // The timer lives in the Location's scope, so it stops as soon as the last borrower lets go
              // (forking into an already closed scope never starts it).
              held
                ? Effect.sleep(HELD_WARNING_AFTER).pipe(
                    Effect.andThen(
                      Effect.suspend(() =>
                        Effect.logWarning("location still held after shutdown", {
                          directory: key.ref.directory,
                          workspaceID: key.ref.workspaceID,
                          instance: key.instance?.key,
                          holders: held.refCount,
                        }),
                      ),
                    ),
                    Effect.forkIn(held.scope),
                    Effect.asVoid,
                  )
                : Effect.void,
            ),
          )
        })
      const evictAll = (keys: readonly Key[]) =>
        Effect.forEach(keys, evict, { discard: true, concurrency: "unbounded" }).pipe(Effect.uninterruptible)
      const map: LocationServiceMap.Interface = {
        get: (ref) => get(at(ref)),
        contextEffect: (ref) => contextEffect(at(ref)),
        contextEffectOption: (ref) =>
          Effect.suspend(() => (reentrant() ? Effect.die(reentrantError()) : inner.contextEffectOption(at(ref)))),
        invalidate: (ref) => {
          const target = LocationServiceMap.canonical(ref)
          return Effect.flatMap(cached, (keys) => evictAll(keys.filter((key) => Equal.equals(key.ref, target))))
        },
        reload: Effect.gen(function* () {
          const keys = yield* cached
          yield* evictAll(keys)
          yield* LocationServiceMap.settle(keys.map(contextEffect))
        }),
        keys: Effect.map(cached, (keys) => Array.from(MutableHashSet.fromIterable(keys.map((key) => key.ref)))),
        has: (ref) => {
          const target = LocationServiceMap.canonical(ref)
          return Effect.map(cached, (keys) => keys.some((key) => Equal.equals(key.ref, target)))
        },
        instances: (build) =>
          Effect.sync(() => {
            const owner = privateBuilds.push(build) - 1
            const key = (ref: Location.Ref, instance: string): Key => ({
              ref: LocationServiceMap.canonical(ref),
              instance: { owner, key: instance },
            })
            return {
              get: (ref, instance) => get(key(ref, instance)),
              has: (ref, instance) => RcMap.has(inner.rcMap, key(ref, instance)),
            }
          }),
      }
      // Stage 1 runs lazily on the first Location or private instance boot, into globalScope (which closes last), so
      // hosts that never open a Location skip Location-only globals while hosts that do build them once for life.
      const stage1: LayerNode.Replacements = [
        // The default selector, for hosts that bring none of their own.
        Instance.node.replace(Layer.succeed(Instance.Service, selector(map))),
        ...replacements,
        LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      ]
      return Context.make(LocationServiceMap.Service, map)
    }).pipe(Scope.provide(owner)),
  )
}
