export * as InstanceMap from "./instance-map.js"

import { Context, Effect, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import type { Location } from "./location.js"
import type { Instance } from "./instance.js"

export interface Interface {
  /** Placement lookup: services for an explicitly requested location. */
  readonly get: (ref: Location.Ref) => Layer.Layer<Instance.Services, Instance.Error>
  readonly contextEffect: (
    ref: Location.Ref,
  ) => Effect.Effect<Context.Context<Instance.Services>, Instance.Error, Scope.Scope>
  readonly invalidate: (ref: Location.Ref) => Effect.Effect<void>
  /** Membership only, including pending and failed entries; does not acquire services. */
  readonly has: (ref: Location.Ref) => Effect.Effect<boolean>
  /** Assignment lookup: services for the instance the Session belongs to. */
  readonly forSession: (session: { readonly location: Location.Ref }) => Layer.Layer<Instance.Services, Instance.Error>
  /** Retained construction inputs for cached entries; does not acquire services. */
  readonly entries: Effect.Effect<ReadonlyArray<{ readonly key: Instance.Key; readonly location: Location.Ref }>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)
