import { Context, Duration, Effect, Exit, Layer, LayerMap, MutableHashMap, Option } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Instance } from "./instance.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { LocationServiceMap } from "./location-service-map.js"
import { FSUtil } from "@opencode/util/fs-util"
import type { PlatformError } from "effect/PlatformError"

export { LocationServiceMap } from "./location-service-map.js"

export type LocationServices = Instance.Services
export type LocationError = Instance.Error

export class DirectoryNotFoundError extends Error {
  constructor(readonly directory: string) {
    super(`Project directory not found: ${directory}`)
  }
}

export class PermissionDeniedError extends Error {
  constructor(readonly directory: string) {
    super(`Cannot access project directory: ${directory}`)
  }
}

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const owner = yield* Effect.scope
      const fs = yield* Effect.serviceOption(FSUtil.Service)
      const builds = MutableHashMap.empty<Location.Ref, { close?: Effect.Effect<void> }>()
      const inner: LayerMap.LayerMap<Location.Ref, LocationServices> = yield* LayerMap.make(
        (ref: Location.Ref) => {
          const build: { close?: Effect.Effect<void> } = {}
          MutableHashMap.set(builds, ref, build)
          return Layer.fromBuild((memoMap, scope) =>
            Effect.suspend(() =>
              (ref.workspaceID || Option.isNone(fs) ? Effect.void : checkDirectory(fs.value, ref)).pipe(
                Effect.orDie,
                Effect.andThen(Layer.buildWithMemoMap(Instance.layer(ref, { replacements: bindings }), memoMap, scope)),
              ),
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
        // Retain healthy graphs; failed checks and boot failures retry on the next use.
        { idleTimeToLive: Duration.infinity },
      )
      const map = {
        ...inner,
        get: (ref: Location.Ref) => inner.get(LocationServiceMap.canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(LocationServiceMap.canonical(ref)),
        contextEffectOption: (ref: Location.Ref) => inner.contextEffectOption(LocationServiceMap.canonical(ref)),
        invalidate: (ref: Location.Ref) =>
          Effect.suspend(() => {
            const key = LocationServiceMap.canonical(ref)
            const build = Option.getOrUndefined(MutableHashMap.get(builds, key))
            MutableHashMap.remove(builds, key)
            // Detach routing first, then cancel interactions and notify clients. Running
            // steps retain their borrowed graph until they can hand off at a boundary.
            // Do not await a boot here: failed/in-flight builds have their own cleanup path.
            return inner.invalidate(key).pipe(Effect.andThen(build?.close ?? Effect.void))
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

function checkDirectory(fs: FSUtil.Interface, ref: Location.Ref) {
  return fs.realPath(ref.directory).pipe(
    Effect.asVoid,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.fail(new DirectoryNotFoundError(ref.directory))),
    Effect.catchTag("PlatformError", (error) =>
      isPermissionDenied(error) ? Effect.fail(new PermissionDeniedError(ref.directory)) : Effect.die(error),
    ),
  )
}

// Effect maps EACCES to PermissionDenied, but macOS privacy blocks report EPERM as Unknown.
export function isPermissionDenied(error: PlatformError) {
  if (error.reason._tag === "PermissionDenied") return true
  const cause = error.cause
  return (
    error.reason._tag === "Unknown" &&
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "EPERM"
  )
}
