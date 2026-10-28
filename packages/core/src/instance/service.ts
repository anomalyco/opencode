export * as Instance from "./service.js"
export type { Services } from "../instance.js"

import { Context, type Effect } from "effect"
import type { Session } from "@opencode/schema/session"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { Services, Error } from "../instance.js"

/** Selects Session capabilities; implementations own caching and lifetime. */
export interface Interface {
  readonly provide: (
    session: Session.Info,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, Exclude<R, Services>>
  /** Whether `provide` would reuse built or booting capabilities. Selectors without it are assumed live. */
  readonly live?: (session: Session.Info) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instance") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)
