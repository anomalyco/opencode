export * as PermissionPolicy from "./policy.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Permission } from "@opencode-ai/schema/permission"
import { Agent } from "../agent.js"
import { Location } from "../location.js"
import { SessionErrors } from "../session/error.js"
import { SessionSchema } from "../session/schema.js"
import { SessionStore } from "../session/store.js"
import { Wildcard } from "../util/wildcard.js"
import { PermissionSaved } from "./saved.js"
import { PluginHooks } from "../plugin/hooks.js"

const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const AssertInput = Schema.Struct({
  id: Permission.ID.pipe(Schema.optional),
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
  agent: Agent.ID.pipe(Schema.optional),
}).annotate({ identifier: "Permission.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export interface Evaluation {
  readonly effect: Permission.Effect
  readonly message?: string
  /** Rules consulted for the decision; a configured deny short-circuits before saved rules apply. */
  readonly rules: Permission.Ruleset
}

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly evaluate: (input: AssertInput) => Effect.Effect<Evaluation, SessionErrors.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionPolicy") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const hooks = yield* PluginHooks.Service

    const savedRules = Effect.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({
          action: item.action,
          resource: item.resource,
          effect: "allow",
        }),
      )
    })

    const configured = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return agent?.permissions ?? missingAgentPermissions
    })

    const evaluateInput = Effect.fn("PermissionPolicy.evaluate")(function* (input: AssertInput) {
      const rules = yield* configured(input.sessionID, input.agent)
      if (input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny"))
        return { effect: "deny", rules } satisfies Evaluation
      const all = [...rules, ...(yield* savedRules())]
      const effects = input.resources.map((resource) => evaluate(input.action, resource, all).effect)
      const effect: Permission.Effect = effects.includes("ask") ? "ask" : "allow"
      const event = yield* hooks.trigger("permission", "evaluate", {
        sessionID: input.sessionID,
        agent: input.agent,
        action: input.action,
        resources: input.resources,
        metadata: input.metadata,
        source: input.source,
        effect,
      })
      return { effect: event.effect, message: event.message, rules: all } satisfies Evaluation
    })

    return Service.of({ evaluate: evaluateInput })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Agent.node, SessionStore.node, PermissionSaved.node, PluginHooks.node],
})
