import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { GoalTable } from "./sql"

export const GoalStatus = Schema.Literals(["active", "achieved", "cleared"])
export type GoalStatus = typeof GoalStatus.Type

export const Info = Schema.Struct({
  condition: Schema.String.annotate({ description: "The goal condition to evaluate" }),
  status: GoalStatus.annotate({ description: "Current status of the goal" }),
  iterations: Schema.Number.annotate({ description: "Number of evaluation cycles" }),
  tokensAtStart: Schema.Number.annotate({ description: "Token count when goal was set" }),
  setAt: Schema.Number.annotate({ description: "Timestamp when goal was set" }),
  evaluatorModel: Schema.optional(
    Schema.Struct({
      providerID: Schema.String,
      modelID: Schema.String,
    }).annotate({ description: "Optional custom evaluator model" }),
  ),
  lastReason: Schema.optional(Schema.String.annotate({ description: "Evaluator's last reason" })),
}).annotate({ identifier: "SessionGoal.Info" })
export type Info = typeof Info.Type

export const Event = {
  Updated: EventV2.define({
    type: "goal.updated",
    schema: {
      sessionID: SessionSchema.ID,
      goal: Schema.optional(Info),
    },
  }),
  Achieved: EventV2.define({
    type: "goal.achieved",
    schema: {
      sessionID: SessionSchema.ID,
      condition: Schema.String,
      iterations: Schema.Number,
      durationMs: Schema.Number,
      tokensUsed: Schema.Number,
    },
  }),
}

export interface Interface {
  readonly set: (input: {
    readonly sessionID: SessionSchema.ID
    readonly condition: string
    readonly tokensAtStart?: number
    readonly evaluatorModel?: { providerID: string; modelID: string }
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Info | undefined>
  readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly achieve: (sessionID: SessionSchema.ID, reason: string) => Effect.Effect<void>
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly iterations?: number
    readonly lastReason?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionGoal") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const set = Effect.fn("SessionGoal.set")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly condition: string
      readonly tokensAtStart?: number
      readonly evaluatorModel?: { providerID: string; modelID: string }
    }) {
      const now = Date.now()
      yield* db
        .insert(GoalTable)
        .values({
          session_id: input.sessionID,
          condition: input.condition,
          status: "active",
          iterations: 0,
          tokens_at_start: input.tokensAtStart ?? 0,
          set_at: now,
          evaluator_model: input.evaluatorModel
            ? JSON.stringify(input.evaluatorModel)
            : undefined,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: GoalTable.session_id,
          set: {
            condition: input.condition,
            status: "active",
            iterations: 0,
            tokens_at_start: input.tokensAtStart ?? 0,
            set_at: now,
            evaluator_model: input.evaluatorModel
              ? JSON.stringify(input.evaluatorModel)
              : undefined,
            last_reason: undefined,
            time_updated: now,
          },
        })
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, {
        sessionID: input.sessionID,
        goal: {
          condition: input.condition,
          status: "active",
          iterations: 0,
          tokensAtStart: input.tokensAtStart ?? 0,
          setAt: now,
          evaluatorModel: input.evaluatorModel,
        },
      })
    })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(GoalTable)
        .where(eq(GoalTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      return {
        condition: row.condition,
        status: row.status as GoalStatus,
        iterations: row.iterations,
        tokensAtStart: row.tokens_at_start,
        setAt: row.set_at,
        evaluatorModel: row.evaluator_model ? JSON.parse(row.evaluator_model) : undefined,
        lastReason: row.last_reason ?? undefined,
      }
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionSchema.ID) {
      yield* db
        .delete(GoalTable)
        .where(eq(GoalTable.session_id, sessionID))
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, { sessionID, goal: undefined })
    })

    const achieve = Effect.fn("SessionGoal.achieve")(function* (
      sessionID: SessionSchema.ID,
      reason: string,
    ) {
      const goal = yield* get(sessionID)
      if (!goal) return
      const durationMs = Date.now() - goal.setAt
      yield* db
        .update(GoalTable)
        .set({
          status: "achieved",
          last_reason: reason,
          time_updated: Date.now(),
        })
        .where(eq(GoalTable.session_id, sessionID))
        .pipe(Effect.orDie)
      yield* events.publish(Event.Achieved, {
        sessionID,
        condition: goal.condition,
        iterations: goal.iterations,
        durationMs,
        tokensUsed: 0,
      })
      yield* events.publish(Event.Updated, {
        sessionID,
        goal: { ...goal, status: "achieved", lastReason: reason },
      })
    })

    const update = Effect.fn("SessionGoal.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly iterations?: number
      readonly lastReason?: string
    }) {
      const set: Record<string, unknown> = { time_updated: Date.now() }
      if (input.iterations !== undefined) set.iterations = input.iterations
      if (input.lastReason !== undefined) set.last_reason = input.lastReason
      yield* db
        .update(GoalTable)
        .set(set)
        .where(eq(GoalTable.session_id, input.sessionID))
        .pipe(Effect.orDie)
    })

    return Service.of({ set, get, clear, achieve, update })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [EventV2.node, Database.node])

export * as SessionGoal from "./goal"
