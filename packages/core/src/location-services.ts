import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option, RcMap, Scope } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services

const HELD_WARNING_AFTER = "30 seconds"

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  // Memoized like any other layer, and given the host's memo map so Stage 1 reuses the globals it already built.
  return Layer.fromBuildMemo((memoMap, owner) =>
    Effect.gen(function* () {
      // Forked first so it closes last: Locations and secondary instance containers shut down before Stage-1 globals.
      const globalScope = yield* Scope.fork(owner)
      const instanceScope = yield* Scope.fork(owner)
      let settled: Exit.Exit<LayerNode.Host> | undefined
      const host = Effect.suspend(
        () =>
          settled ??
          Effect.die(
            new Error(
              "A global service booted a Location while its host was still building globals; boot it after startup",
            ),
          ),
      )
      const builds = MutableHashMap.empty<Location.Ref, { close?: Effect.Effect<void> }>()
      const inner: LayerMap.LayerMap<Location.Ref, LocationServices, Instance.Error> = yield* LayerMap.make(
        (ref: Location.Ref) => {
          const build: { close?: Effect.Effect<void> } = {}
          MutableHashMap.set(builds, ref, build)
          return Layer.fromBuild((memoMap, scope) =>
            host
              .pipe(
                Effect.flatMap((resolved) =>
                  Layer.buildWithMemoMap(Instance.layer(ref, { host: resolved }), memoMap, scope),
                ),
              )
              .pipe(
                Effect.onExit((exit) => {
                  const finish = Effect.suspend(() => {
                    if (Exit.isSuccess(exit)) {
                      return Effect.gen(function* () {
                        const lifecycle = Context.get(exit.value, LocationLifecycle.Service)
                        // A boot detached while in flight still needs shutdown and cancellation.
                        if (Option.getOrUndefined(MutableHashMap.get(builds, ref)) !== build)
                          return yield* lifecycle.shutdown
                        build.close = lifecycle.shutdown
                      })
                    }
                    // An explicitly invalidated build must not evict its replacement.
                    if (Option.getOrUndefined(MutableHashMap.get(builds, ref)) !== build) return Effect.void
                    MutableHashMap.remove(builds, ref)
                    // Evict once per failed build, before its result reaches borrowers.
                    return Exit.isFailure(exit) ? inner.invalidate(ref) : Effect.void
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
      // RcMap closes entries one at a time on shutdown. Close every Location
      // (borrowed ones too) concurrently first; RcMap then finds them closed.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() =>
          inner.rcMap.state._tag === "Closed"
            ? Effect.void
            : Effect.forEach(inner.rcMap.state.map, ([, entry]) => Effect.exit(Scope.close(entry.scope, Exit.void)), {
                concurrency: "unbounded",
                discard: true,
              }),
        ),
      )
      const map: LocationServiceMap.Interface = {
        ...inner,
        host,
        instanceScope,
        get: (ref: Location.Ref) => inner.get(LocationServiceMap.canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(LocationServiceMap.canonical(ref)),
        contextEffectOption: (ref: Location.Ref) => inner.contextEffectOption(LocationServiceMap.canonical(ref)),
        invalidate: (ref: Location.Ref) =>
          Effect.suspend(() => {
            const key = LocationServiceMap.canonical(ref)
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
                            directory: key.directory,
                            workspaceID: key.workspaceID,
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
          }).pipe(Effect.uninterruptible),
      }
      // Stage 1: build every global a Location reaches, once, before any Location boots. Globals that depend on
      // this map or on Instance receive the map itself rather than waiting on the layer currently being built.
      const stage1: LayerNode.Replacements = [
        // The default selector, for hosts that bring none of their own.
        Instance.node.replace(
          Layer.succeed(Instance.Service, {
            provide: (session) => Effect.provide(map.get(session.location)),
            live: (session) => RcMap.has(inner.rcMap, LocationServiceMap.canonical(session.location)),
          }),
        ),
        ...replacements,
        LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      ]
      yield* Effect.suspend(() =>
        Layer.buildWithMemoMap(
          LayerNode.compile(Instance.globals(stage1), { replacements: stage1 }),
          memoMap,
          globalScope,
        ),
      ).pipe(
        // Like a Location's other boot failures, a global that fails to build is a defect.
        Effect.orDie,
        Effect.onExit((exit) =>
          Effect.sync(() => {
            settled = Exit.map(exit, (context) => ({ tag: Node.tags.values.global, context, replacements }))
          }),
        ),
      )
      return Context.make(LocationServiceMap.Service, map)
    }).pipe(Scope.provide(owner)),
  )
}
