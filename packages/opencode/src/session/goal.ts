import { BusEvent } from "@/bus/bus-event"
import { Database, and, eq, isNull } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { NonNegativeInt, PositiveInt, optionalOmitUndefined } from "@opencode-ai/core/schema"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { ProjectID } from "../project/schema"
import { GoalID, MessageID, SessionID } from "./schema"
import { SessionGoalTable, SessionTable } from "./session.sql"

export const Status = Schema.Literals(["active", "paused", "budget_limited", "complete"]).annotate({
  identifier: "SessionGoalStatus",
})
export type Status = Schema.Schema.Type<typeof Status>

const Tokens = Schema.Struct({
  used: NonNegativeInt,
  budget: optionalOmitUndefined(NonNegativeInt),
})

const Time = Schema.Struct({
  used: NonNegativeInt,
  created: NonNegativeInt,
  updated: NonNegativeInt,
})

export const Info = Schema.Struct({
  id: GoalID,
  sessionID: SessionID,
  objective: Schema.String,
  status: Status,
  tokens: Tokens,
  time: Time,
}).annotate({ identifier: "SessionGoal" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  objective: Schema.String,
  tokenBudget: Schema.optional(PositiveInt),
})
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const UpdateInput = Schema.Struct({
  sessionID: SessionID,
  objective: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  tokenBudget: Schema.optional(Schema.NullOr(PositiveInt)),
})
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const AccountInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  tokens: NonNegativeInt,
  seconds: NonNegativeInt,
})
export type AccountInput = Types.DeepMutable<Schema.Schema.Type<typeof AccountInput>>

export const ModelUpdateInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  status: Status,
})
export type ModelUpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof ModelUpdateInput>>

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  goal: Info,
})

const ClearedEventSchema = Schema.Struct({
  sessionID: SessionID,
})

export const Event = {
  Updated: SyncEvent.define({
    type: "session.goal.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
  }),
  Cleared: SyncEvent.define({
    type: "session.goal.cleared",
    version: 1,
    aggregate: "sessionID",
    schema: ClearedEventSchema,
  }),
}

export const BusOnlyEvent = {
  IdleContinue: BusEvent.define(
    "session.goal.idle_continue",
    Schema.Struct({
      sessionID: SessionID,
      goal: Info,
    }),
  ),
}

export class GoalError extends Error {}
type NotFound = InstanceType<typeof NotFoundError>

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info | undefined>
  readonly listActive: (input?: { projectID?: ProjectID }) => Effect.Effect<Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<Info, GoalError>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, GoalError | NotFound>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
  readonly account: (input: AccountInput) => Effect.Effect<Info | undefined>
  readonly modelUpdate: (input: ModelUpdateInput) => Effect.Effect<Info, GoalError | NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

function fromRow(row: typeof SessionGoalTable.$inferSelect): Info {
  return {
    id: row.id,
    sessionID: row.session_id,
    objective: row.objective,
    status: row.status as Status,
    tokens: {
      used: row.tokens_used,
      budget: row.token_budget ?? undefined,
    },
    time: {
      used: row.time_used,
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

export function toRow(goal: Info): typeof SessionGoalTable.$inferInsert {
  return {
    id: goal.id,
    session_id: goal.sessionID,
    objective: goal.objective,
    status: goal.status,
    token_budget: goal.tokens.budget ?? null,
    tokens_used: goal.tokens.used,
    time_used: goal.time.used,
    time_created: goal.time.created,
    time_updated: goal.time.updated,
  }
}

function objective(input: string) {
  const text = input.trim()
  if (!text) return Effect.fail(new GoalError("Goal objective is required"))
  if (text.length > 4000) return Effect.fail(new GoalError("Goal objective is too long"))
  return Effect.succeed(text)
}

function budget(input: number | null | undefined) {
  if (input !== undefined && input !== null && input <= 0) {
    return Effect.fail(new GoalError("Goal token budget must be positive"))
  }
  return Effect.void
}

export const layer: Layer.Layer<Service, never, SyncEvent.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sync = yield* SyncEvent.Service
    const completeAccounting = new Map<
      SessionID,
      {
        messageID: MessageID
        tokens: boolean
        time: boolean
      }
    >()
    const budgetAccounting = new Map<
      SessionID,
      {
        messageID?: MessageID
        time: boolean
      }
    >()

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      const row = Database.use((db) =>
        db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).get(),
      )
      return row ? fromRow(row) : undefined
    })

    const listActive = Effect.fn("SessionGoal.listActive")(function* (input?: { projectID?: ProjectID }) {
      const conditions = [eq(SessionGoalTable.status, "active"), isNull(SessionTable.time_archived)]
      if (input?.projectID) conditions.push(eq(SessionTable.project_id, input.projectID))
      const rows = Database.use((db) =>
        db
          .select({
            id: SessionGoalTable.id,
            session_id: SessionGoalTable.session_id,
            objective: SessionGoalTable.objective,
            status: SessionGoalTable.status,
            token_budget: SessionGoalTable.token_budget,
            tokens_used: SessionGoalTable.tokens_used,
            time_used: SessionGoalTable.time_used,
            time_created: SessionGoalTable.time_created,
            time_updated: SessionGoalTable.time_updated,
          })
          .from(SessionGoalTable)
          .innerJoin(SessionTable, eq(SessionGoalTable.session_id, SessionTable.id))
          .where(and(...conditions))
          .all(),
      )
      return rows.map(fromRow)
    })

    const emit = Effect.fn("SessionGoal.emit")(function* (goal: Info) {
      yield* sync.run(Event.Updated, { sessionID: goal.sessionID, goal })
      return goal
    })

    const create = Effect.fn("SessionGoal.create")(function* (input: CreateInput) {
      const text = yield* objective(input.objective)
      yield* budget(input.tokenBudget)
      if (yield* get(input.sessionID)) return yield* Effect.fail(new GoalError("Goal already exists"))

      return yield* emit({
        id: GoalID.ascending(),
        sessionID: input.sessionID,
        objective: text,
        status: "active",
        tokens: {
          used: 0,
          budget: input.tokenBudget,
        },
        time: {
          used: 0,
          created: Date.now(),
          updated: Date.now(),
        },
      })
    })

    const update = Effect.fn("SessionGoal.update")(function* (input: UpdateInput) {
      const current = yield* get(input.sessionID)
      if (!current) {
        return yield* Effect.fail(new NotFoundError({ message: `Goal not found: ${input.sessionID}` }))
      }
      const text = input.objective === undefined ? current.objective : yield* objective(input.objective)
      yield* budget(input.tokenBudget)
      const nextBudget = input.tokenBudget === undefined ? current.tokens.budget : (input.tokenBudget ?? undefined)
      const nextStatus = input.status ?? current.status
      const exhausted = nextBudget !== undefined && current.tokens.used >= nextBudget
      const status: Status =
        nextStatus === "active" || nextStatus === "budget_limited"
          ? exhausted
            ? "budget_limited"
            : "active"
          : nextStatus
      const next = {
        ...current,
        objective: text,
        status,
        tokens: {
          ...current.tokens,
          budget: nextBudget,
        },
        time: {
          ...current.time,
          updated: Date.now(),
        },
      }
      if (next.status !== "complete") completeAccounting.delete(input.sessionID)
      if (next.status !== "budget_limited") budgetAccounting.delete(input.sessionID)
      return yield* emit(next)
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID) {
      completeAccounting.delete(sessionID)
      budgetAccounting.delete(sessionID)
      yield* sync.run(Event.Cleared, { sessionID })
    })

    const account = Effect.fn("SessionGoal.account")(function* (input: AccountInput) {
      const current = yield* get(input.sessionID)
      if (!current) return undefined
      if (current.status === "complete") {
        const completion = completeAccounting.get(input.sessionID)
        if (!input.messageID || completion?.messageID !== input.messageID) return current
        const tokens = completion.tokens ? 0 : input.tokens
        const seconds = completion.time ? 0 : input.seconds
        if (tokens === 0 && seconds === 0) return current
        if (input.tokens > 0) completion.tokens = true
        if (input.seconds > 0) completion.time = true
        if (completion.tokens && completion.time) completeAccounting.delete(input.sessionID)
        return yield* emit({
          ...current,
          tokens: {
            ...current.tokens,
            used: current.tokens.used + tokens,
          },
          time: {
            ...current.time,
            used: current.time.used + seconds,
            updated: Date.now(),
          },
        })
      }
      if (current.status !== "active") {
        if (current.status !== "budget_limited" || input.tokens !== 0 || input.seconds === 0) return current
        const budget = budgetAccounting.get(input.sessionID)
        if (!budget || budget.time) return current
        if (budget.messageID !== undefined && input.messageID !== budget.messageID) return current
        budget.time = true
        budgetAccounting.delete(input.sessionID)
        return yield* emit({
          ...current,
          time: {
            ...current.time,
            used: current.time.used + input.seconds,
            updated: Date.now(),
          },
        })
      }
      const used = current.tokens.used + input.tokens
      const status =
        current.status === "active" && current.tokens.budget !== undefined && used >= current.tokens.budget
          ? "budget_limited"
          : current.status
      if (status === "budget_limited") {
        if (input.seconds > 0) budgetAccounting.delete(input.sessionID)
        else budgetAccounting.set(input.sessionID, { messageID: input.messageID, time: false })
      }
      return yield* emit({
        ...current,
        status,
        tokens: {
          ...current.tokens,
          used,
        },
        time: {
          ...current.time,
          used: current.time.used + input.seconds,
          updated: Date.now(),
        },
      })
    })

    const modelUpdate = Effect.fn("SessionGoal.modelUpdate")(function* (input: ModelUpdateInput) {
      if (input.status !== "complete") {
        return yield* Effect.fail(new GoalError("Models can only mark goals complete"))
      }
      const goal = yield* update({ sessionID: input.sessionID, status: "complete" })
      if (input.messageID) {
        completeAccounting.set(input.sessionID, {
          messageID: input.messageID,
          tokens: false,
          time: false,
        })
      }
      return goal
    })

    return Service.of({ get, listActive, create, update, clear, account, modelUpdate })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(Layer.provide(SyncEvent.defaultLayer))

export * as SessionGoal from "./goal"
