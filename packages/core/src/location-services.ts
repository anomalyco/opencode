import fs from "node:fs/promises"
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

// An identity that could not be pinned when the graph booted: the directory had no VCS yet, or
// the repository has no commit or remote to name it. Only these graphs can become stale.
type Provisional = {
  readonly id: Project.ID
  readonly vcs: boolean
  readonly resolve: Effect.Effect<Project.Resolved>
}

const exists = (target: string) =>
  Effect.tryPromise(() => fs.access(target)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

type Build = {
  close?: Effect.Effect<void>
  provisional?: Provisional
}

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const owner = yield* Effect.scope
      const builds = MutableHashMap.empty<Location.Ref, Build>()
      const inner: LayerMap.LayerMap<Location.Ref, LocationServices, Instance.Error> = yield* LayerMap.make(
        (ref: Location.Ref) => {
          const build: Build = {}
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
                      const location = Context.get(exit.value, Location.Service)
                      if (location.vcs !== undefined && location.project.id !== Project.ID.global) return
                      build.provisional = {
                        id: location.project.id,
                        vcs: location.vcs !== undefined,
                        resolve: lifecycle.resolveProject,
                      }
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
      // opencode already opened). Nothing re-resolves a cached graph, so the graphs whose identity
      // could not be pinned are re-resolved before a borrow. Only unborrowed locations are touched:
      // a running step keeps the graph it resolved and hands off once it releases it.
      const refresh = (key: Location.Ref) =>
        Effect.suspend(() => {
          const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
          const provisional = build?.provisional
          if (!build || !provisional) return Effect.void
          const state = inner.rcMap.state
          const held = state._tag === "Open" ? Option.getOrUndefined(MutableHashMap.get(state.map, key)) : undefined
          if (held && held.refCount > 0) return Effect.void
          return Effect.gen(function* () {
            // A graph without a VCS only changes once a marker appears at or above its directory
            // (opening `proj/src` before `proj` becomes a repo). Project.root walks up with async
            // probes; graphs that already resolved a VCS skip it.
            if (!provisional.vcs) {
              const root = yield* Project.root({ exists }, key.directory)
              if (root === undefined) return
            }
            // An open terminal or client socket keeps its Location loaded; rebuilding would end it.
            const retained = yield* Effect.scoped(
              inner.contextEffectOption(key).pipe(
                Effect.map((context) =>
                  Option.exists(context, (context) =>
                    Option.exists(Context.getOption(context, LocationLifecycle.Service), (lifecycle) =>
                      lifecycle.isRetained(),
                    ),
                  ),
                ),
                Effect.orElseSucceed(() => false),
              ),
            )
            if (retained) return
            const resolved = yield* provisional.resolve
            if (resolved.id === provisional.id) return
            // Another refresh may have replaced this build while the identity resolved.
            if (Option.getOrUndefined(MutableHashMap.get(builds, key)) !== build) return
            MutableHashMap.remove(builds, key)
            // Detach without shutting the old graph down. Invalidate releases it when its last
            // borrower lets go, so a running step is never interrupted mid-turn.
            yield* inner.invalidate(key)
          })
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
