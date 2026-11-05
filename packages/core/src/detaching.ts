export * as Detaching from "./detaching.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/**
 * Planned-shutdown state of this server process.
 *
 * A prepared daemon handoff means a new server will take over the daemon's processes. If this server
 * then shuts down, it is detaching: work that can outlive it in the daemon is left running and recorded
 * for the new server instead of being stopped. Without a prepared handoff (a normal quit), shutdown
 * stops everything as before.
 */
export interface Interface {
  /** Records that a daemon handoff was prepared successfully. */
  readonly handoffPrepared: Effect.Effect<void>
  /** Called once shutdown starts, before any service is torn down. Returns whether this server is detaching. */
  readonly begin: Effect.Effect<boolean>
  readonly isDetaching: () => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Detaching") {}

export const make = Effect.sync(() => {
  let prepared = false
  let detaching = false
  return Service.of({
    handoffPrepared: Effect.sync(() => {
      prepared = true
    }),
    begin: Effect.sync(() => {
      detaching = prepared
      return detaching
    }),
    isDetaching: () => detaching,
  })
})

export const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
