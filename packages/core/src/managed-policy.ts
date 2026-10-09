export * as ManagedPolicy from "./managed-policy.js"

import { Document, type Entry } from "@opencode/schema/config"
import { isDeepStrictEqual } from "node:util"
import { Wildcard } from "./util/wildcard.js"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Context, Effect, Layer, PubSub, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

/** Policy statements the connected OpenCode Console compiled for whoever it authenticated. */
export interface State {
  readonly statements: ReadonlyArray<ConfigPolicy.Info>
  /** Organization name for denial messages, when the connection knows it. */
  readonly organization?: string
}

export interface Interface {
  readonly changes: () => Stream.Stream<void>
  /** Synchronous so catalog transforms can consult the statements while they run. */
  readonly current: () => State
  /** Replaces the whole state; statements never merge across connections. */
  readonly set: (state: State) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ManagedPolicy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<void>()
    const state: { current: State } = { current: { statements: [] } }
    return Service.of({
      changes: () => Stream.fromPubSub(changes),
      current: () => state.current,
      set: (next) =>
        Effect.gen(function* () {
          const changed =
            state.current.organization !== next.organization ||
            !isDeepStrictEqual(state.current.statements, next.statements)
          state.current = next
          if (!changed) return
          yield* PubSub.publish(changes, undefined)
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export function statements(entries: readonly Entry[], organization: State) {
  return [
    ...entries
      .filter((entry): entry is Document => entry.type === "document")
      .toReversed()
      .flatMap((entry) => entry.info.experimental?.policies ?? [])
      .map((policy) => ({ ...policy, message: "Blocked by configuration policy" })),
    ...organization.statements.map((policy) => ({
      ...policy,
      message: organization.organization
        ? `Blocked by ${organization.organization}'s policy`
        : "Blocked by your organization's policy",
    })),
  ]
}

export function decision(
  policies: readonly ConfigPolicy.Info[],
  action: ConfigPolicy.Info["action"],
  resource: string,
) {
  return (
    policies.findLast((policy) => policy.action === action && Wildcard.match(resource, policy.resource))?.effect ??
    "allow"
  )
}
