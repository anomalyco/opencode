export * as Permission from "./permission.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { isRecord } from "@opencode/util/record"
import { Context, Deferred, Effect, Layer, Schema, Scope } from "effect"
import { Permission } from "@opencode/schema/permission"
import type { Tool } from "@opencode/schema/tool"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { Agent } from "./agent.js"
import { SessionErrors } from "./session/error.js"
import { SessionSchema } from "./session/schema.js"
import { SessionStore } from "./session/store.js"
import { PermissionPolicy } from "./permission/policy.js"
import { PermissionSaved } from "./permission/saved.js"
import { PluginHooks } from "./plugin/hooks.js"

export * as Policy from "./permission/policy.js"
const PermissionEffect = Permission.Effect
export { PermissionEffect as Effect }
export { Rule, Ruleset } from "@opencode/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export interface AssertInput extends Omit<Request, "id" | "message"> {
  readonly id?: ID
  readonly agent?: Agent.ID
}

/** The requester fields of a permission request made by a tool call. */
export const invocation = (context: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">) => ({
  sessionID: context.sessionID,
  agent: context.agent,
  source: { type: "tool" as const, messageID: context.messageID, id: context.id },
})

export interface ReplyInput {
  readonly requestID: ID
  readonly reply: Reply
  readonly message?: string
}

export interface AskResult {
  readonly id: ID
  readonly effect: Permission.Effect
}

export { Event } from "@opencode/schema/permission"

/**
 * Rules that settle a request which would otherwise ask, for work nobody is present to answer, such as a schedule's
 * check. A request they do not allow is denied. Configured denies still win, as they are evaluated first.
 */
export const Unattended = Context.Reference<Permission.Ruleset | undefined>("@opencode/Permission/Unattended", {
  defaultValue: () => undefined,
})

export class DeclinedError extends Schema.TaggedError<DeclinedError>()("Permission.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedError<CorrectedError>()("Permission.CorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return this.feedback
  }
}

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

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError

export { ignoresCase, pathActions } from "./permission/policy.js"

/**
 * What "Allow always" saves for a web URL: its site, so approving one page doesn't allow every URL. Rules match the URL
 * as written, so the site is kept as written, with and without a path. The site ends where URL parsing ends it,
 * including at `\`, which parsers treat as `/`. A URL with credentials or whitespace in its site
 * (`https://opencode.ai@evil.com` goes to evil.com) saves only itself. Rules treat `*` and `?` as wildcards, so a site
 * with either, such as `https://*`, gets no pattern, and neither does an unusual URL with either: no "Allow always".
 */
export function site(url: string) {
  const origin = /^https?:\/\/[^/\\?#@\s*]+(?=[/\\?#]|$)/i.exec(url)?.[0]
  if (origin) return [origin, `${origin}/*`]
  return /[*?]/.test(url) ? [] : [url]
}

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return PermissionPolicy.evaluate(PermissionPolicy.fromRules(...rulesets), action, resource)
}

/** True when every resource for `action` is denied; trailing narrow denies preserve a blanket deny while any `allow` or `ask` keeps the action reachable. */
export function isActionDenied(action: string, ...rulesets: Permission.Ruleset[]): boolean {
  return PermissionPolicy.isActionDenied(PermissionPolicy.fromRules(...rulesets), action)
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly close: Effect.Effect<void>
  readonly ask: (input: AssertInput) => Effect.Effect<AskResult, SessionErrors.NotFoundError>
  readonly assert: (input: AssertInput) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  /** Fails only when the rules deny the request; never asks the user. */
  readonly assertNotDenied: (input: AssertInput) => Effect.Effect<void, BlockedError | SessionErrors.NotFoundError>
  /** True only when the rules already allow the request; never asks the user. */
  readonly allows: (input: AssertInput) => Effect.Effect<boolean, SessionErrors.NotFoundError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  /**
   * Marks `call` as made by `parent`, such as a call inside a Code Mode program. It has an ID of its own but no row,
   * so until the scope closes, requests naming it as their source show on `parent`'s row.
   */
  readonly nested: (call: Tool.CallID, parent: Tool.CallID) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

interface Pending {
  readonly request: Request
  readonly agent?: Agent.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const hooks = yield* PluginHooks.Service
    const pending = new Map<ID, Pending>()
    const parents = new Map<string, Tool.CallID>()
    let closed = false

    const close = Effect.gen(function* () {
      closed = true
      yield* Effect.forEach(Array.from(pending.values()), (item) =>
        bus
          .publish(Permission.Event.Replied, {
            sessionID: item.request.sessionID,
            requestID: item.request.id,
            reply: "reject",
          })
          .pipe(Effect.ensuring(Deferred.fail(item.deferred, new DeclinedError()))),
      )
      pending.clear()
    }).pipe(Effect.uninterruptible)
    yield* Effect.addFinalizer(() => close)

    const savedPolicy = Effect.fnUntraced(function* () {
      return PermissionPolicy.fromRules(
        (yield* saved.list({ projectID: location.project.id })).map(
          (item): Permission.Rule => ({
            action: item.action,
            resource: item.resource,
            effect: "allow",
          }),
        ),
      )
    })

    const configured = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return PermissionPolicy.fromRules(agent?.permissions ?? missingAgentPermissions, session.permissions ?? [])
    })

    const nested: Interface["nested"] = (call, parent) =>
      Effect.acquireRelease(
        Effect.sync(() => void parents.set(call, parent)),
        () => Effect.sync(() => void parents.delete(call)),
      )

    function row(source: AssertInput["source"]) {
      const parent = source && parents.get(source.id)
      return parent ? { ...source, id: parent } : source
    }

    const evaluateInput = Effect.fnUntraced(function* (input: AssertInput) {
      const base = yield* configured(input.sessionID, input.agent)
      if (PermissionPolicy.evaluateAll(base, input.action, input.resources) === "deny")
        return { effect: "deny" as const, policy: base }
      const effective = PermissionPolicy.fallback(base, yield* savedPolicy())
      const effect = PermissionPolicy.evaluateAll(effective, input.action, input.resources)
      const event = yield* hooks.trigger("permission", "evaluate", {
        sessionID: input.sessionID,
        agent: input.agent,
        action: input.action,
        resources: input.resources,
        metadata: input.metadata,
        source: row(input.source),
        effect,
      })
      const unattended = yield* Unattended
      if (event.effect !== "ask" || unattended === undefined)
        return { effect: event.effect, message: event.message, policy: effective }
      // When an evaluate hook downgraded `allow` to `ask`, unattended rules must explicitly allow the request
      // rather than inheriting the pre-hook `allow` from `effective`.
      const settled =
        effect === "ask" ? PermissionPolicy.override(effective, unattended) : PermissionPolicy.fromRules(unattended)
      if (
        (effect === "ask" || input.resources.length > 0) &&
        PermissionPolicy.evaluateAll(settled, input.action, input.resources) === "allow"
      )
        return { effect: "allow" as const, policy: effective }
      return {
        effect: "deny" as const,
        message: `Permission ${input.action} needs approval, and nobody is present to give it`,
        policy: effective,
      }
    })

    function request(input: AssertInput, message?: string): Request {
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        save: input.save,
        metadata: input.metadata && withoutUndefined(input.metadata),
        source: row(input.source),
        message,
      }
    }

    const create = (request: Request, agent?: Agent.ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          const item = { request, agent, deferred }
          if (closed) {
            yield* Deferred.fail(deferred, new DeclinedError())
            return item
          }
          if (pending.has(request.id))
            return yield* Effect.die(new Error(`Duplicate pending permission ID: ${request.id}`))
          pending.set(request.id, item)
          yield* bus
            .publish(Permission.Event.Asked, request)
            .pipe(Effect.onError(() => Effect.sync(() => pending.delete(request.id))))
          return item
        }),
      )

    const ask = Effect.fn("Permission.ask")(function* (input: AssertInput) {
      if (closed) return { id: input.id ?? ID.create(), effect: "deny" as const }
      const result = yield* evaluateInput(input)
      const value = request(input, result.message)
      if (result.effect === "ask") yield* create(value, input.agent)
      return { id: value.id, effect: result.effect }
    })

    const assert = Effect.fn("Permission.assert")((input: AssertInput) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.die(new DeclinedError())
        const result = yield* evaluateInput(input)
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (result.effect === "deny") {
              return yield* new BlockedError({
                rules: PermissionPolicy.relevant(result.policy, input.action),
                permission: input.action,
                resources: input.resources,
                reason: result.message,
              })
            }
            if (result.effect === "allow") return
            const item = yield* create(request(input, result.message), input.agent)
            return yield* restore(Deferred.await(item.deferred)).pipe(
              // Deliberate defect tunnel: leaves wrap execution in blanket `mapError`, which
              // must not convert a user's decline into model-facing tool output. The decline
              // resurfaces as a typed failure at SessionModelRequest.executeTool. A decline
              // WITH feedback (CorrectedError) intentionally stays typed so the leaf can turn
              // it into ToolFailure and the model continues.
              Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)),
              Effect.ensuring(
                Effect.sync(() => {
                  pending.delete(item.request.id)
                }),
              ),
            )
          }),
        )
      }),
    )

    const assertNotDenied = Effect.fn("Permission.assertNotDenied")(function* (input: AssertInput) {
      const result = yield* evaluateInput(input)
      if (result.effect !== "deny") return
      return yield* new BlockedError({
        rules: PermissionPolicy.relevant(result.policy, input.action),
        permission: input.action,
        resources: input.resources,
        reason: result.message,
      })
    })

    const allows = Effect.fn("Permission.allows")(function* (input: AssertInput) {
      if (closed) return false
      return (yield* evaluateInput(input)).effect === "allow"
    })

    const reply = Effect.fn("Permission.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          yield* bus.publish(Permission.Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            reply: input.reply,
          })

          if (input.reply === "reject") {
            yield* Deferred.fail(
              existing.deferred,
              input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
            )
            pending.delete(input.requestID)
            for (const [id, item] of pending) {
              if (item.request.sessionID !== existing.request.sessionID) continue
              if (item.request.source?.messageID !== existing.request.source?.messageID) continue
              yield* bus.publish(Permission.Event.Replied, {
                sessionID: item.request.sessionID,
                requestID: item.request.id,
                reply: "reject",
              })
              // Feedback applies to the whole batch, so parallel asks don't end the step.
              yield* Deferred.fail(
                item.deferred,
                input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
              )
              pending.delete(id)
            }
            return
          }

          if (input.reply === "always" && existing.request.save?.length) {
            yield* saved.add({
              projectID: location.project.id,
              action: existing.request.action,
              resources: existing.request.save,
            })
          }
          yield* Deferred.succeed(existing.deferred, undefined)
          pending.delete(input.requestID)
          if (input.reply !== "always" || !existing.request.save?.length) return

          for (const [id, item] of pending) {
            const result = yield* evaluateInput({ ...item.request, agent: item.agent }).pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.undefined),
            )
            if (result?.effect !== "allow") continue
            yield* bus.publish(Permission.Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "always",
            })
            yield* Deferred.succeed(item.deferred, undefined)
            pending.delete(id)
          }
        }),
      ),
    )

    const list = Effect.fn("Permission.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = Effect.fn("Permission.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = Effect.fn("Permission.forSession")(function* (sessionID: SessionSchema.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ ask, assert, assertNotDenied, allows, reply, get, forSession, list, nested, close })
  }),
)

// Tools copy optional inputs straight into metadata, nested objects included; undefined values are not JSON
// and would fail the HttpApi response encoder when clients list pending requests.
function withoutUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, isRecord(value) ? withoutUndefined(value) : value]),
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Location.node, Agent.node, SessionStore.node, PermissionSaved.node, PluginHooks.node],
})
