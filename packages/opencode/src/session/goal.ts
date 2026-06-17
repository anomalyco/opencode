import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { GoalTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

export const Status = Schema.Literals(["active", "paused", "completed"])
export type Status = Schema.Schema.Type<typeof Status>

export const Info = Schema.Struct({
  text: Schema.String.annotate({ description: "The active goal for this session" }),
  status: Status,
  budgetTokens: Schema.optional(Schema.Number).annotate({ description: "Optional token budget for the goal" }),
  tokensUsed: Schema.Number,
  timeMs: Schema.Number,
  startedAt: Schema.Number,
  pausedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
  verification: Schema.optional(Schema.String),
}).annotate({ identifier: "Goal" })
export type Info = Schema.Schema.Type<typeof Info>

export const Event = {
  Updated: EventV2.define({
    type: "goal.updated",
    schema: {
      sessionID: SessionID,
      goal: Schema.NullOr(Info),
    },
  }),
}

export interface Interface {
  readonly set: (input: { sessionID: SessionID; text: string; budgetTokens?: number }) => Effect.Effect<Info>
  readonly update: (input: {
    sessionID: SessionID
    text?: string
    status?: Status
    budgetTokens?: number | null
    verification?: string
  }) => Effect.Effect<Info | undefined>
  readonly pause: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly resume: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly recordUsage: (input: { sessionID: SessionID; tokens: number; durationMs: number }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const now = () => Date.now()

    const read = (sessionID: SessionID) =>
      db
        .select()
        .from(GoalTable)
        .where(eq(GoalTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)

    const toInfo = (row: {
      text: string
      status: string
      budget_tokens: number | null
      tokens_used: number
      time_ms: number
      started_at: number
      paused_at: number | null
      completed_at: number | null
      verification: string | null
    }): Info => ({
      text: row.text,
      status: row.status as Status,
      budgetTokens: row.budget_tokens ?? undefined,
      tokensUsed: row.tokens_used,
      timeMs: row.time_ms,
      startedAt: row.started_at,
      pausedAt: row.paused_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      verification: row.verification ?? undefined,
    })

    const publish = (sessionID: SessionID, goal: Info | undefined) =>
      events.publish(Event.Updated, { sessionID, goal: goal ?? null })

    const set = Effect.fn("Goal.set")(function* (input: { sessionID: SessionID; text: string; budgetTokens?: number }) {
      const ts = now()
      yield* db
        .insert(GoalTable)
        .values({
          session_id: input.sessionID,
          text: input.text,
          status: "active",
          budget_tokens: input.budgetTokens ?? null,
          tokens_used: 0,
          time_ms: 0,
          started_at: ts,
          paused_at: null,
          completed_at: null,
          verification: null,
          time_created: ts,
          time_updated: ts,
        })
        .onConflictDoUpdate({
          target: GoalTable.session_id,
          set: {
            text: input.text,
            status: "active",
            budget_tokens: input.budgetTokens ?? null,
            paused_at: null,
            completed_at: null,
            verification: null,
            time_updated: ts,
          },
        })
        .run()
        .pipe(Effect.orDie)
      const row = yield* read(input.sessionID)
      const info = row ? toInfo(row) : ({ text: input.text, status: "active", tokensUsed: 0, timeMs: 0, startedAt: ts } as Info)
      yield* publish(input.sessionID, info)
      return info
    })

    const update = Effect.fn("Goal.update")(function* (input: {
      sessionID: SessionID
      text?: string
      status?: Status
      budgetTokens?: number | null
      verification?: string
    }) {
      const current = yield* read(input.sessionID)
      if (!current) return undefined
      const ts = now()
      const status = input.status
      const next = {
        text: input.text ?? current.text,
        status: status ?? (current.status as Status),
        budget_tokens: input.budgetTokens === undefined ? current.budget_tokens : input.budgetTokens,
        tokens_used: current.tokens_used,
        time_ms: current.time_ms,
        started_at: current.started_at,
        paused_at: current.paused_at,
        completed_at: current.completed_at,
        verification: input.verification ?? current.verification,
        time_updated: ts,
      }
      if (status === "paused" && !next.paused_at) next.paused_at = ts
      if (status === "active" && next.paused_at) next.paused_at = null
      if (status === "completed" && !next.completed_at) next.completed_at = ts
      yield* db
        .update(GoalTable)
        .set(next)
        .where(eq(GoalTable.session_id, input.sessionID))
        .run()
        .pipe(Effect.orDie)
      const row = yield* read(input.sessionID)
      const info = row ? toInfo(row) : undefined
      yield* publish(input.sessionID, info)
      return info
    })

    const pause = Effect.fn("Goal.pause")(function* (sessionID: SessionID) {
      return yield* update({ sessionID, status: "paused" })
    })

    const resume = Effect.fn("Goal.resume")(function* (sessionID: SessionID) {
      return yield* update({ sessionID, status: "active" })
    })

    const clear = Effect.fn("Goal.clear")(function* (sessionID: SessionID) {
      yield* db.delete(GoalTable).where(eq(GoalTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* publish(sessionID, undefined)
    })

    const get = Effect.fn("Goal.get")(function* (sessionID: SessionID) {
      const row = yield* read(sessionID)
      return row ? toInfo(row) : undefined
    })

    const recordUsage = Effect.fn("Goal.recordUsage")(function* (input: {
      sessionID: SessionID
      tokens: number
      durationMs: number
    }) {
      const current = yield* read(input.sessionID)
      if (!current || current.status !== "active") return
      const ts = now()
      yield* db
        .update(GoalTable)
        .set({
          tokens_used: current.tokens_used + Math.max(0, Math.floor(input.tokens)),
          time_ms: current.time_ms + Math.max(0, Math.floor(input.durationMs)),
          time_updated: ts,
        })
        .where(eq(GoalTable.session_id, input.sessionID))
        .run()
        .pipe(Effect.orDie)
      const row = yield* read(input.sessionID)
      if (row) yield* publish(input.sessionID, toInfo(row))
    })

    return Service.of({ set, update, pause, resume, clear, get, recordUsage })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer), Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [EventV2Bridge.node, Database.node])

export * as Goal from "./goal"
