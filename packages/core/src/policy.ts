export * as Policy from "./policy"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Wildcard } from "./util/wildcard"
import { Location } from "./location"

const PolicyEffect = Schema.Literals(["allow", "deny"]).annotate({ identifier: "Policy.Effect" })
export { PolicyEffect as Effect }
export type Effect = typeof PolicyEffect.Type

export class Info extends Schema.Class<Info>("Policy.Info")({
  action: Schema.String,
  effect: PolicyEffect,
  resource: Schema.String,
}) {}

export interface Interface {
  readonly load: (statements: Info[]) => Effect.Effect<void>
  readonly evaluate: (action: string, resource: string, fallback: Effect) => Effect.Effect<Effect>
  readonly hasStatements: () => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Policy") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let statements: Info[] = []
    yield* Location.Service

    return Service.of({
      load: Effect.fn("Policy.load")(function* (input) {
        statements = input
      }),
      hasStatements: () => statements.length > 0,
      evaluate: Effect.fn("Policy.evaluate")(function* (action, resource, fallback) {
        return (
          statements.findLast(
            (statement) => Wildcard.match(action, statement.action) && Wildcard.match(resource, statement.resource),
          )?.effect ?? fallback
        )
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node] })
