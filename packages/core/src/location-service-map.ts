import { Context, Duration, Effect, Exit, Layer, LayerMap, Option, RcMap, Scope } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Node } from "@opencode/util/effect/app-node"
import { AbsolutePath } from "@opencode/schema/schema"
import path from "path"
import { Location } from "./location.js"
import type { Instance } from "./instance.js"

export interface Interface {
  readonly get: (ref: Location.Ref) => Layer.Layer<Instance.Services, Instance.Error>
  readonly contextEffect: (
    ref: Location.Ref,
  ) => Effect.Effect<Context.Context<Instance.Services>, Instance.Error, Scope.Scope>
  /** Retains the Location's default services only when they are already cached. */
  readonly contextEffectOption: (
    ref: Location.Ref,
  ) => Effect.Effect<Option.Option<Context.Context<Instance.Services>>, Instance.Error, Scope.Scope>
  /** Retains every instance currently cached at the Location, default and private alike. */
  readonly cachedContexts: (
    ref: Location.Ref,
  ) => Effect.Effect<readonly Context.Context<Instance.Services>[], Instance.Error, Scope.Scope>
  /** Shuts down every instance cached at the Location, its private instances included. */
  readonly invalidate: (ref: Location.Ref) => Effect.Effect<void>
  /** Rebuilds every cached instance, letting all builds settle even if one fails. */
  readonly reload: Effect.Effect<void, Instance.Error>
  /** The Locations with any cached instance, each once. */
  readonly keys: Effect.Effect<readonly Location.Ref[]>
  /** Whether any instance, default or private, is cached at the Location. */
  readonly has: (ref: Location.Ref) => Effect.Effect<boolean>
  /** Registers a builder for private instances that share a Location's lifecycle; absent on hand-built maps. */
  readonly instances?: (build: PrivateBuild) => Effect.Effect<PrivateInstances>
}

/** Builds the private instance for `key` at `ref` on a cache miss, standing on the host's Stage-1 globals. */
export type PrivateBuild = (
  ref: Location.Ref,
  key: string,
  host: LayerNode.Host,
) => Layer.Layer<Instance.Services, Instance.Error>

export interface PrivateInstances {
  readonly get: (ref: Location.Ref, key: string) => Layer.Layer<Instance.Services, Instance.Error>
  readonly has: (ref: Location.Ref, key: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

/** A map that builds every Location with `lookup`, without host globals or private instances. */
export const make = <R>(
  lookup: (ref: Location.Ref) => Layer.Layer<Instance.Services, Instance.Error, R>,
  options: { readonly idleTimeToLive?: Duration.Input } = {},
) =>
  Effect.map(LayerMap.make(lookup, options), (map): Interface => {
    const keys = Effect.map(RcMap.keys(map.rcMap), Array.from<Location.Ref>)
    return {
      get: (ref) => map.get(canonical(ref)),
      contextEffect: (ref) => map.contextEffect(canonical(ref)),
      contextEffectOption: (ref) => map.contextEffectOption(canonical(ref)),
      cachedContexts: (ref) =>
        Effect.map(map.contextEffectOption(canonical(ref)), (item) => (Option.isSome(item) ? [item.value] : [])),
      invalidate: (ref) => map.invalidate(canonical(ref)),
      keys,
      has: (ref) => RcMap.has(map.rcMap, canonical(ref)),
      reload: Effect.gen(function* () {
        const refs = yield* keys
        yield* Effect.forEach(refs, map.invalidate, { discard: true, concurrency: "unbounded" })
        yield* settle(refs.map((ref) => map.contextEffect(ref)))
      }),
    }
  })

/** Boots every replacement now and fails with the first failure only after all builds settle. */
export const settle = Effect.fnUntraced(function* <E>(builds: readonly Effect.Effect<unknown, E, Scope.Scope>[]) {
  const results = yield* Effect.forEach(builds, (build) => Effect.scoped(build).pipe(Effect.asVoid, Effect.exit), {
    concurrency: "unbounded",
  })
  const failure = results.find(Exit.isFailure)
  if (failure) return yield* Effect.failCause(failure.cause)
  yield* Effect.logInfo("location services reloaded", { count: builds.length })
})

/** Normalize equivalent placements before they become resource-cache keys. */
export function canonical(ref: Location.Ref) {
  // Workspace refs can hold remote POSIX paths even on a Windows host.
  const flavor = process.platform === "win32" && !ref.directory.startsWith("/") ? path.win32 : path.posix
  const normalized = flavor.normalize(ref.directory)
  const trailing = normalized.endsWith(flavor.sep) && normalized.length > flavor.parse(normalized).root.length
  return Location.Ref.make({
    directory: AbsolutePath.make(trailing ? normalized.slice(0, -1) : normalized),
    workspaceID: ref.workspaceID,
  })
}

export * as LocationServiceMap from "./location-service-map.js"
