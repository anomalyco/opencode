import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Form } from "./form.js"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services

type BuildRecord = {
  /** Cancels the entry's pending forms, carrying the invalidate cause (the scope finalizer cannot). */
  closeForms?: (options?: Form.CloseOptions) => Effect.Effect<void>
  /** The entry's lifecycle shutdown, invoked after routing detach as today. */
  close?: (options?: Form.CloseOptions) => Effect.Effect<void>
}

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const owner = yield* Effect.scope
      const builds = MutableHashMap.empty<Location.Ref, BuildRecord>()
      const inner: LayerMap.LayerMap<Location.Ref, LocationServices> = yield* LayerMap.make(
        (ref: Location.Ref) => {
          const build: BuildRecord = {}
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
                        return yield* lifecycle.shutdown()
                      build.close = lifecycle.shutdown
                      build.closeForms = (options) => Context.get(exit.value, Form.Service).close(options)
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
      const map = {
        ...inner,
        get: (ref: Location.Ref) => inner.get(LocationServiceMap.canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(LocationServiceMap.canonical(ref)),
        contextEffectOption: (ref: Location.Ref) => inner.contextEffectOption(LocationServiceMap.canonical(ref)),
        invalidate: (ref: Location.Ref, options?: Form.CloseOptions) =>
          Effect.suspend(() => {
            const key = LocationServiceMap.canonical(ref)
            const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
            MutableHashMap.remove(builds, key)
            if (options?.cause !== undefined)
              // A cause-carrying invalidate must deliver the cause to the pending forms'
              // cancellation: with no borrowers, inner.invalidate closes the entry scope
              // synchronously, and the scope finalizer's close cannot carry a cause. Cancel
              // the forms with the cause before detaching; the shutdown that follows (its
              // own forms close included) finds them settled.
              return (build?.closeForms?.(options) ?? Effect.void).pipe(
                Effect.andThen(() => inner.invalidate(key).pipe(Effect.andThen(build?.close?.(options) ?? Effect.void))),
              )
            // Detach routing first, then cancel interactions and notify clients. Running
            // steps retain their borrowed graph until they can hand off at a boundary.
            // Do not await a boot here: failed/in-flight builds have their own cleanup path.
            return inner.invalidate(key).pipe(Effect.andThen(build?.close?.(options) ?? Effect.void))
          }).pipe(Effect.uninterruptible),
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
