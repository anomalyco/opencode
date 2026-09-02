export * as Permission from "./permission.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Permission } from "@opencode-ai/schema/permission"
import { Location } from "./location.js"
import { SessionErrors } from "./session/error.js"
import { SessionSchema } from "./session/schema.js"
import { Wildcard } from "./util/wildcard.js"
import { PermissionLedger } from "./permission/ledger.js"
import { PermissionPolicy } from "./permission/policy.js"

const PermissionEffect = Permission.Effect
export { PermissionEffect as Effect }
export { Rule, Ruleset } from "@opencode-ai/schema/permission"

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export { AssertInput, evaluate, merge } from "./permission/policy.js"
export { ReplyInput, DeclinedError, CorrectedError, NotFoundError } from "./permission/ledger.js"

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "Permission.AskResult" })
export type AskResult = typeof AskResult.Type

export { Event } from "@opencode-ai/schema/permission"

export class BlockedError extends Schema.TaggedError<BlockedError>()("Permission.BlockedError", {
  rules: Permission.Ruleset,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
  reason: Schema.String.pipe(Schema.optional),
}) {
  override get message() {
    return this.reason ?? `Permission denied: ${this.permission}`
  }
}

export type Error = BlockedError | PermissionLedger.CorrectedError

/**
 * Location-scoped entry point composing PermissionPolicy (this Location's rules, agents,
 * and hooks) with the host-wide PermissionLedger of pending requests.
 */
export interface Interface {
  readonly ask: (input: PermissionPolicy.AssertInput) => Effect.Effect<AskResult, SessionErrors.NotFoundError>
  readonly assert: (input: PermissionPolicy.AssertInput) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  readonly reply: (input: PermissionLedger.ReplyInput) => Effect.Effect<void, PermissionLedger.NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const policy = yield* PermissionPolicy.Service
    const ledger = yield* PermissionLedger.Service
    const scope = yield* Effect.scope
    const ref = Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID })

    const register = (input: PermissionPolicy.AssertInput, message?: string) =>
      ledger.register({
        request: {
          id: input.id ?? ID.create(),
          sessionID: input.sessionID,
          action: input.action,
          resources: input.resources,
          save: input.save,
          metadata: input.metadata,
          source: input.source,
          message,
        },
        agent: input.agent,
        location: ref,
        projectID: location.project.id,
        reevaluate: policy.evaluate(input).pipe(
          Effect.map((result) => result.effect),
          Effect.catchTag("Session.NotFoundError", () => Effect.undefined),
        ),
      })

    // Register and guard in one uninterruptible region: an interrupt that lands during
    // registration fires the moment `restore` opens, so the guard must already be attached.
    const settle = (
      registration: PermissionLedger.Registration,
      restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
    ) => restore(registration.await).pipe(Effect.ensuring(registration.cancel))

    const ask = Effect.fn("Permission.ask")(function* (input: PermissionPolicy.AssertInput) {
      const result = yield* policy.evaluate(input)
      if (result.effect !== "ask") return { id: input.id ?? ID.create(), effect: result.effect }
      const registration = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const registration = yield* register(input, result.message)
          // Nothing awaits a detached request, so park a waiter in this instance's scope:
          // closing the instance cancels the request and clients drop the prompt.
          yield* Effect.forkIn(
            Effect.uninterruptibleMask((restore) => settle(registration, restore)).pipe(Effect.ignore),
            scope,
            { startImmediately: true },
          )
          return registration
        }),
      )
      return { id: registration.request.id, effect: result.effect }
    })

    const assert = Effect.fn("Permission.assert")(function* (input: PermissionPolicy.AssertInput) {
      const result = yield* policy.evaluate(input)
      if (result.effect === "deny") {
        return yield* new BlockedError({
          rules: result.rules.filter((rule) => Wildcard.match(input.action, rule.action)),
          permission: input.action,
          resources: input.resources,
          reason: result.message,
        })
      }
      if (result.effect === "allow") return
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const registration = yield* register(input, result.message)
          return yield* settle(registration, restore).pipe(
            // Deliberate defect tunnel: leaves wrap execution in blanket `mapError`, which
            // must not convert a user's decline into model-facing tool output. The decline
            // resurfaces as a typed failure at SessionModelRequest.executeTool. A decline
            // WITH feedback (CorrectedError) intentionally stays typed so the leaf can turn
            // it into ToolFailure and the model continues.
            Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)),
          )
        }),
      )
    })

    return Service.of({
      ask,
      assert,
      reply: ledger.reply,
      get: ledger.get,
      forSession: ledger.forSession,
      list: () => ledger.list(),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, PermissionPolicy.node, PermissionLedger.node],
})
