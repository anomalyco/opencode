export * as PermissionV2 from "./permission"

import { Context, Deferred, Effect as EffectRuntime, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { Location } from "./location"
import { SessionV2 } from "./session"
import { withStatics } from "./schema"
import { Identifier } from "./util/identifier"
import { Wildcard } from "./util/wildcard"
import { PermissionTable } from "./permission/sql"

export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("PermissionV2.ID"),
  withStatics((schema) => ({ create: (id?: string) => schema.make(id ?? "per_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export const Effect = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionV2.Effect" })
export type Effect = typeof Effect.Type

export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
}).annotate({ identifier: "PermissionV2.Rule" })
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionV2.Ruleset" })
export type Ruleset = typeof Ruleset.Type

export const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("tool"),
    messageID: Schema.String,
    callID: Schema.String,
  }),
]).annotate({ identifier: "PermissionV2.Source" })
export type Source = typeof Source.Type

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionV2.ID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  remember: Schema.Array(Schema.String).pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  source: Source.pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.Request" })
export type Request = typeof Request.Type

export const Reply = Schema.Literals(["once", "always", "reject"]).annotate({ identifier: "PermissionV2.Reply" })
export type Reply = typeof Reply.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  sessionID: SessionV2.ID,
  action: Schema.String,
  resources: Schema.Array(Schema.String),
  remember: Schema.Array(Schema.String).pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  source: Source.pipe(Schema.optional),
  rules: Ruleset,
}).annotate({ identifier: "PermissionV2.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "PermissionV2.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const Event = {
  Asked: EventV2.define({ type: "permission.v2.asked", schema: Request.fields }),
  Replied: EventV2.define({
    type: "permission.v2.replied",
    schema: {
      sessionID: SessionV2.ID,
      requestID: ID,
      reply: Reply,
    },
  }),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionV2.RejectedError", {}) {}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionV2.CorrectedError", {
  feedback: Schema.String,
}) {}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionV2.DeniedError", {
  rules: Ruleset,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("PermissionV2.NotFoundError", {
  requestID: ID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError

export function evaluate(action: string, resource: string, ...rulesets: Ruleset[]): Rule {
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

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly ask: (input: AssertInput) => EffectRuntime.Effect<Request>
  readonly assert: (input: AssertInput) => EffectRuntime.Effect<void, Error>
  readonly reply: (input: ReplyInput) => EffectRuntime.Effect<void, NotFoundError>
  readonly get: (id: ID) => EffectRuntime.Effect<Request | undefined>
  readonly list: () => EffectRuntime.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Permission") {}

interface Pending {
  readonly request: Request
  readonly rules: Ruleset
  readonly deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

export const layer = Layer.effect(
  Service,
  EffectRuntime.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const pending = new Map<ID, Pending>()

    yield* EffectRuntime.addFinalizer(() =>
      EffectRuntime.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new RejectedError()), {
        discard: true,
      }).pipe(
        EffectRuntime.ensuring(
          EffectRuntime.sync(() => {
            pending.clear()
          }),
        ),
      ),
    )

    const remembered = EffectRuntime.fn("PermissionV2.remembered")(function* () {
      const rows = yield* db
        .select()
        .from(PermissionTable)
        .where(eq(PermissionTable.project_id, location.project.id))
        .all()
        .pipe(EffectRuntime.orDie)
      return rows.map((row): Rule => ({ action: row.action, resource: row.resource, effect: "allow" }))
    })

    const evaluateInput = EffectRuntime.fnUntraced(function* (input: AssertInput) {
      const rules = [...input.rules, ...(yield* remembered())]
      const effects = input.resources.map((resource) => evaluate(input.action, resource, rules).effect)
      const effect: Effect = effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
      return { effect, rules }
    })

    const create = EffectRuntime.fnUntraced(function* (input: AssertInput) {
      const request: Request = {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        remember: input.remember,
        metadata: input.metadata,
        source: input.source,
      }
      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      const item = { request, rules: input.rules, deferred }
      pending.set(request.id, item)
      yield* events.publish(Event.Asked, request)
      return item
    })

    const ask = EffectRuntime.fn("PermissionV2.ask")(function* (input: AssertInput) {
      const pending = yield* create(input)
      return pending.request
    })

    const assert = EffectRuntime.fn("PermissionV2.assert")(function* (input: AssertInput) {
      const result = yield* evaluateInput(input)
      if (result.effect === "deny") {
        return yield* new DeniedError({
          rules: result.rules.filter((candidate) => Wildcard.match(input.action, candidate.action)),
        })
      }
      if (result.effect === "allow") return
      const item = yield* create(input)
      return yield* Deferred.await(item.deferred).pipe(
        EffectRuntime.ensuring(
          EffectRuntime.sync(() => {
            pending.delete(item.request.id)
          }),
        ),
      )
    })

    const reply = EffectRuntime.fn("PermissionV2.reply")(function* (input: ReplyInput) {
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.request.sessionID,
        requestID: existing.request.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )
        for (const [id, item] of pending) {
          if (item.request.sessionID !== existing.request.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.request.sessionID,
            requestID: item.request.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      if (input.reply === "always" && existing.request.remember?.length) {
        yield* db
          .insert(PermissionTable)
          .values(
            existing.request.remember.map((resource) => ({
              project_id: location.project.id,
              action: existing.request.action,
              resource,
            })),
          )
          .onConflictDoNothing()
          .run()
          .pipe(EffectRuntime.orDie)
      }
      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply !== "always" || !existing.request.remember?.length) return

      const rememberedRules = yield* remembered()
      for (const [id, item] of pending) {
        const rules = [...item.rules, ...rememberedRules]
        if (
          !item.request.resources.every((resource) => evaluate(item.request.action, resource, rules).effect === "allow")
        )
          continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.request.sessionID,
          requestID: item.request.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = EffectRuntime.fn("PermissionV2.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = EffectRuntime.fn("PermissionV2.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    return Service.of({ ask, assert, reply, get, list })
  }),
)

export const locationLayer = layer
