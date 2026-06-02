import { ConfigPermission } from "@/config/permission"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import os from "os"
import { PermissionLegacy } from "@opencode-ai/core/permission/legacy"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

const log = Log.create({ service: "permission" })

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: PermissionLegacy.Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: PermissionLegacy.Request.fields.sessionID,
      requestID: PermissionLegacy.ID,
      reply: PermissionLegacy.Reply,
    },
  }),
}

export interface Interface {
  readonly ask: (input: PermissionLegacy.AskInput) => Effect.Effect<void, PermissionLegacy.Error>
  readonly reply: (input: PermissionLegacy.ReplyInput) => Effect.Effect<void, PermissionLegacy.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionLegacy.Request>>
}

interface PendingEntry {
  info: PermissionLegacy.Request
  deferred: Deferred.Deferred<void, PermissionLegacy.RejectedError | PermissionLegacy.CorrectedError>
}

interface State {
  pending: Map<PermissionLegacy.ID, PendingEntry>
  approved: PermissionLegacy.Rule[]
}

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: PermissionLegacy.Ruleset[]
): PermissionLegacy.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionLegacy.ID, PendingEntry>(),
          approved: [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionLegacy.RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: PermissionLegacy.AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new PermissionLegacy.DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionLegacy.ID.ascending()
      const info: PermissionLegacy.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      }
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, PermissionLegacy.RejectedError | PermissionLegacy.CorrectedError>()
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionLegacy.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionLegacy.NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionLegacy.CorrectedError({ feedback: input.message })
            : new PermissionLegacy.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionLegacy.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: PermissionLegacy.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionLegacy.Ruleset[]): PermissionLegacy.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionLegacy.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export * as Permission from "."
