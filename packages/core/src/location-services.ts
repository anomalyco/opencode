import { existsSync } from "node:fs"
import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option, Scope } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Project } from "./project.js"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services

const HELD_WARNING_AFTER = "30 seconds"

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const owner = yield* Effect.scope
      const fs = { exists: (path: string) => Effect.sync(() => existsSync(path)) }
      const builds = MutableHashMap.empty<
        Location.Ref,
        { close?: Effect.Effect<void>; markerless?: boolean; marker?: string }
      >()
      const inner: LayerMap.LayerMap<Location.Ref, LocationServices, Instance.Error> = yield* LayerMap.make(
        (ref: Location.Ref) => {
          const build: { close?: Effect.Effect<void>; markerless?: boolean; marker?: string } = {}
          MutableHashMap.set(builds, ref, build)
          return Layer.fromBuild((memoMap, scope) =>
            Effect.suspend(() =>
              Layer.buildWithMemoMap(Instance.layer(ref, { replacements: bindings }), memoMap, scope),
            ).pipe(
              Effect.onExit((exit) => {
                const finish = Effect.suspend(() => {
                  if (Exit.isSuccess(exit)) {
                    return Effect.gen(function* () {
                      const lifecycle = Context.get(exit.value, LocationLifecycle.Service)
                      // A boot detached while in flight still needs shutdown and cancellation.
                      if (Option.getOrUndefined(MutableHashMap.get(builds, ref)) !== build)
                        return yield* lifecycle.shutdown
                      build.close = lifecycle.shutdown
                      // Remember whether this graph resolved a VCS identity, and which marker it saw.
                      // A markerless graph is the only one that can become wrong later.
                      build.markerless = Context.get(exit.value, Location.Service).vcs === undefined
                      if (build.markerless)
                        build.marker = yield* Project.root(fs, ref.directory).pipe(Effect.orElseSucceed(() => undefined))
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
      // Detach routing first, then cancel interactions and notify clients. Running
      // steps retain their borrowed graph until they can hand off at a boundary.
      // Do not await a boot here: failed/in-flight builds have their own cleanup path.
      const drop = (key: Location.Ref) =>
        Effect.suspend(() => {
          const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
          MutableHashMap.remove(builds, key)
          const state = inner.rcMap.state
          const held = state._tag === "Open" ? Option.getOrUndefined(MutableHashMap.get(state.map, key)) : undefined
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
        }).pipe(Effect.uninterruptible)
      // A directory can turn into a VCS root after its graph was built (git init in a folder that
      // opencode already opened). Nothing re-resolves a cached graph, so a markerless one is
      // dropped as soon as the markers above it change and the next borrow rebuilds it with the
      // identity its sessions are stored under.
      const refresh = (key: Location.Ref) =>
        Effect.suspend(() => {
          const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
          if (!build?.markerless) return Effect.void
          return Project.root(fs, key.directory).pipe(
            Effect.orElseSucceed(() => undefined),
            Effect.flatMap((root) => (root === build.marker ? Effect.void : drop(key))),
          )
        })
      const map = {
        ...inner,
        get: (ref: Location.Ref) => {
          const key = LocationServiceMap.canonical(ref)
          return Layer.unwrap(Effect.suspend(() => refresh(key).pipe(Effect.as(inner.get(key)))))
        },
        contextEffect: (ref: Location.Ref) =>
          Effect.suspend(() => {
            const key = LocationServiceMap.canonical(ref)
            return refresh(key).pipe(Effect.andThen(inner.contextEffect(key)))
          }),
        contextEffectOption: (ref: Location.Ref) =>
          Effect.suspend(() => {
            const key = LocationServiceMap.canonical(ref)
            return refresh(key).pipe(Effect.andThen(inner.contextEffectOption(key)))
          }),
        invalidate: (ref: Location.Ref) => drop(LocationServiceMap.canonical(ref)),
      }
      // Cached instances borrow their owner instead of retaining its Layer scope.
      const bindings: LayerNode.Replacements = [
        Instance.node.replace(
          Layer.succeed(Instance.Service, {
            provide: (session) => Effect.provide(map.get(session.location)),
          }),
        ),
        ...replacements,
        LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      ]
      return map
    }),
  )
}
