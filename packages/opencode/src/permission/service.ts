import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"
import { InstanceState } from "@/util/instance-state"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Effect, Layer, Schema, ServiceMap } from "effect"
import z from "zod"
import { PermissionID } from "./schema"

const log = Log.create({ service: "permission" })

export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})
export type Action = z.infer<typeof Action>

export const Rule = z
  .object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  .meta({
    ref: "PermissionRule",
  })
export type Rule = z.infer<typeof Rule>

export const Ruleset = Rule.array().meta({
  ref: "PermissionRuleset",
})
export type Ruleset = z.infer<typeof Ruleset>

export const Request = z
  .object({
    id: PermissionID.zod,
    sessionID: SessionID.zod,
    permission: z.string(),
    patterns: z.string().array(),
    metadata: z.record(z.string(), z.any()),
    always: z.string().array(),
    tool: z
      .object({
        messageID: MessageID.zod,
        callID: z.string(),
      })
      .optional(),
  })
  .meta({
    ref: "PermissionRequest",
  })
export type Request = z.infer<typeof Request>

export const Reply = z.enum(["once", "always", "reject"])
export type Reply = z.infer<typeof Reply>

export const Approval = z.object({
  projectID: ProjectID.zod,
  patterns: z.string().array(),
})

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    z.object({
      sessionID: SessionID.zod,
      requestID: PermissionID.zod,
      reply: Reply,
    }),
  ),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export type PermissionError = DeniedError | RejectedError | CorrectedError

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

type State = {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
}

export const AskInput = Request.partial({ id: true }).extend({
  ruleset: Ruleset,
})

export const ReplyInput = z.object({
  requestID: PermissionID.zod,
  reply: Reply,
  message: z.string().optional(),
})

export declare namespace PermissionService {
  export interface Api {
    readonly ask: (input: z.infer<typeof AskInput>) => Effect.Effect<void, PermissionError>
    readonly reply: (input: z.infer<typeof ReplyInput>) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
  }
}

export class PermissionService extends ServiceMap.Service<PermissionService, PermissionService.Api>()(
  "@opencode/PermissionNext",
) {
  static readonly layer = Layer.effect(
    PermissionService,
    Effect.gen(function* () {
      const instanceState = yield* InstanceState.make<State>(() =>
        Effect.sync(() => {
          const row = Database.use((db) =>
            db.select().from(PermissionTable).where(eq(PermissionTable.project_id, Instance.project.id)).get(),
          )
          return {
            pending: new Map<PermissionID, PendingEntry>(),
            approved: row?.data ?? [],
          }
        }),
      )

      const ask = Effect.fn("PermissionService.ask")(function* (input: z.infer<typeof AskInput>) {
        const state = yield* InstanceState.get(instanceState)
        const { ruleset, ...request } = input
        let pending = false

        for (const pattern of request.patterns) {
          const rule = evaluate(request.permission, pattern, ruleset, state.approved)
          log.info("evaluated", { permission: request.permission, pattern, action: rule })
          if (rule.action === "deny") {
            return yield* new DeniedError({
              ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
            })
          }
          if (rule.action === "allow") continue
          pending = true
        }

        if (!pending) return

        const id = request.id ?? PermissionID.ascending()
        const info: Request = {
          id,
          ...request,
        }
        log.info("asking", { id, permission: info.permission, patterns: info.patterns })

        const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
        state.pending.set(id, { info, deferred })
        void Bus.publish(Event.Asked, info)
        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            state.pending.delete(id)
          }),
        )
      })

      const reply = Effect.fn("PermissionService.reply")(function* (input: z.infer<typeof ReplyInput>) {
        const state = yield* InstanceState.get(instanceState)
        const existing = state.pending.get(input.requestID)
        if (!existing) return

        state.pending.delete(input.requestID)
        void Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: input.reply,
        })

        if (input.reply === "reject") {
          yield* Deferred.fail(
            existing.deferred,
            input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
          )

          for (const [id, item] of state.pending.entries()) {
            if (item.info.sessionID !== existing.info.sessionID) continue
            state.pending.delete(id)
            void Bus.publish(Event.Replied, {
              sessionID: item.info.sessionID,
              requestID: item.info.id,
              reply: "reject",
            })
            yield* Deferred.fail(item.deferred, new RejectedError())
          }
          return
        }

        yield* Deferred.succeed(existing.deferred, undefined)
        if (input.reply === "once") return

        for (const pattern of existing.info.always) {
          state.approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        for (const [id, item] of state.pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          const ok = item.info.patterns.every(
            (pattern) => evaluate(item.info.permission, pattern, state.approved).action === "allow",
          )
          if (!ok) continue
          state.pending.delete(id)
          void Bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "always",
          })
          yield* Deferred.succeed(item.deferred, undefined)
        }

        // TODO: we don't save the permission ruleset to disk yet until there's
        // UI to manage it
        // db().insert(PermissionTable).values({ projectID: Instance.project.id, data: s.approved })
        //   .onConflictDoUpdate({ target: PermissionTable.projectID, set: { data: s.approved } }).run()
      })

      const list = Effect.fn("PermissionService.list")(function* () {
        const state = yield* InstanceState.get(instanceState)
        return Array.from(state.pending.values(), (item) => item.info)
      })

      return PermissionService.of({ ask, reply, list })
    }),
  )
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  const merged = rulesets.flat()
  log.info("evaluate", { permission, pattern, ruleset: merged })
  const match = merged.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
