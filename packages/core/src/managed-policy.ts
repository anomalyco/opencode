export * as ManagedPolicy from "./managed-policy.js"

import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/** Policy statements the connected OpenCode Console compiled for whoever it authenticated. */
export interface State {
  readonly statements: ReadonlyArray<ConfigPolicy.Info>
  /** Organization name for denial messages, when the connection knows it. */
  readonly organization?: string
}

export interface Interface {
  /** Synchronous so catalog transforms can consult the statements while they run. */
  readonly current: () => State
  /** Replaces the whole state; statements never merge across connections. */
  readonly set: (state: State) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ManagedPolicy") {}

const layer = Layer.sync(Service, () => {
  const state: { current: State } = { current: { statements: [] } }
  return Service.of({
    current: () => state.current,
    set: (next) =>
      Effect.sync(() => {
        state.current = next
      }),
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
