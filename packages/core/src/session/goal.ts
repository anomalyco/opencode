export * as SessionGoal from "./goal.js"

import { and, asc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { SessionGoal as SessionGoalSchema } from "@opencode/schema/session-goal"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionGoalActivation } from "./goal-activation.js"
import { SessionGoalTable, SessionTodoTable } from "./sql.js"
import type { SessionSchema } from "./schema.js"

type DatabaseService = Database.Interface["db"]

/** Rounds a goal may run before it is pushed to `blocked`; the driver enforces it. */
export const DefaultMaxGoalRounds = 8

/**
 * Upsert the current goal. The bus projects each committed event exactly once and in
 * order, so the latest event always wins and no revision guard is needed. A new goal
 * identity starts a fresh todo list, so the previous goal's list is dropped.
 */
export const projectUpdated = Effect.fn("SessionGoal.projectUpdated")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly snapshot: SessionGoalSchema.Snapshot
  },
) {
  const values = {
    session_id: input.sessionID,
    goal_id: input.snapshot.id,
    revision: input.snapshot.revision,
    objective: input.snapshot.objective,
    phase: input.snapshot.phase,
    blocked_reason: input.snapshot.blockedReason ?? null,
    max_goal_rounds: input.snapshot.maxGoalRounds,
  }
  const current = yield* db
    .select({ goal_id: SessionGoalTable.goal_id })
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, input.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (current && current.goal_id !== input.snapshot.id) yield* clearTodos(db, input.sessionID)
  yield* db
    .insert(SessionGoalTable)
    .values(values)
    .onConflictDoUpdate({ target: SessionGoalTable.session_id, set: values })
    .run()
    .pipe(Effect.orDie)
})

/** Delete the goal row and its todo list. The tombstone stays in the event log for audit. */
export const projectCleared = Effect.fn("SessionGoal.projectCleared")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly goalID: SessionGoalSchema.ID
  },
) {
  yield* clearTodos(db, input.sessionID)
  yield* db
    .delete(SessionGoalTable)
    .where(and(eq(SessionGoalTable.session_id, input.sessionID), eq(SessionGoalTable.goal_id, input.goalID)))
    .run()
    .pipe(Effect.orDie)
})

/**
 * Replace the whole list and advance the goal revision, so a stale verification is
 * rejected. The revision is the same counter a verification is judged against, so an
 * event that does not advance it is dropped: letting it through would rewind the goal
 * to a number an already-stale verdict carries. A list only exists under a goal, so an
 * event with no goal row is dropped as well instead of writing a list no verdict can match.
 */
export const projectTodoUpdated = Effect.fn("SessionGoal.projectTodoUpdated")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly revision: number
    readonly todos: ReadonlyArray<SessionGoalSchema.TodoInput>
  },
) {
  const goal = yield* db
    .select({ revision: SessionGoalTable.revision })
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, input.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!goal || input.revision <= goal.revision) return
  yield* clearTodos(db, input.sessionID)
  if (input.todos.length > 0)
    yield* db
      .insert(SessionTodoTable)
      .values(
        input.todos.map((todo, position) => ({
          session_id: input.sessionID,
          position,
          content: todo.content,
          status: todo.status,
          acceptance: todo.acceptance ?? null,
        })),
      )
      .run()
      .pipe(Effect.orDie)
  yield* db
    .update(SessionGoalTable)
    .set({ revision: input.revision })
    .where(eq(SessionGoalTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

/**
 * Apply one verifier verdict. The verdict carries the goal revision it judged; a
 * stale revision (the list changed since) is rejected, and rounds only advance when
 * a goal row exists.
 */
export const projectTodoVerified = Effect.fn("SessionGoal.projectTodoVerified")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly revision: number
    readonly items: ReadonlyArray<SessionGoalSchema.TodoVerification>
  },
) {
  const goal = yield* db
    .select({ revision: SessionGoalTable.revision })
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, input.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!goal || goal.revision !== input.revision) return
  yield* Effect.forEach(
    input.items,
    (item) =>
      db
        .update(SessionTodoTable)
        .set({ status: item.status, feedback: item.feedback })
        .where(and(eq(SessionTodoTable.session_id, input.sessionID), eq(SessionTodoTable.position, item.position)))
        .run()
        .pipe(Effect.orDie),
    { discard: true },
  )
  yield* db
    .update(SessionGoalTable)
    .set({ rounds: sql`${SessionGoalTable.rounds} + 1` })
    .where(eq(SessionGoalTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

function clearTodos(db: DatabaseService, sessionID: SessionSchema.ID) {
  return db.delete(SessionTodoTable).where(eq(SessionTodoTable.session_id, sessionID)).run().pipe(Effect.orDie)
}

export const read = Effect.fn("SessionGoal.read")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const row = yield* db
    .select()
    .from(SessionGoalTable)
    .where(eq(SessionGoalTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
  return row ? fromRow(row) : undefined
})

export const readTodo = Effect.fn("SessionGoal.readTodo")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select()
    .from(SessionTodoTable)
    .where(eq(SessionTodoTable.session_id, sessionID))
    .orderBy(asc(SessionTodoTable.position))
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => ({
    position: row.position,
    content: row.content,
    status: row.status,
    acceptance: row.acceptance ?? undefined,
    feedback: row.feedback ?? undefined,
  }))
})

function fromRow(row: typeof SessionGoalTable.$inferSelect): SessionGoalSchema.Snapshot {
  return {
    id: row.goal_id,
    revision: row.revision,
    objective: row.objective,
    phase: row.phase,
    blockedReason: row.blocked_reason ?? undefined,
    maxGoalRounds: row.max_goal_rounds,
  }
}

/** A goal mutation rejected because the goal is missing, in the wrong phase, or stale. */
export class ConflictError extends Schema.TaggedError<ConflictError>()("SessionGoal.ConflictError", {
  message: Schema.String,
}) {}

export interface UpdateInput {
  readonly action: "set" | "clear" | "edit" | "pause" | "resume"
  readonly objective?: string
  /** CAS: the revision the client last read. Supply `expectedGoalID` with it. */
  readonly expectedRevision?: number
  /** CAS: the goal identity the client last read. A missing id never matches. */
  readonly expectedGoalID?: SessionGoalSchema.ID
}

/**
 * The compare-and-set token. A revision alone is not enough: `set` starts a new
 * goal at revision 1, so a client holding revision 1 of the previous goal would
 * otherwise pass against a different goal. The pair is compared together.
 */
export interface Expected {
  readonly revision: number
  /** A missing id never matches an existing goal, so a client that omits it fails closed. */
  readonly goalID: SessionGoalSchema.ID | undefined
}

export interface Interface {
  readonly read: (sessionID: SessionSchema.ID) => Effect.Effect<SessionGoalSchema.Snapshot | undefined>
  readonly readTodo: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<SessionGoalSchema.TodoItem>>
  readonly readState: (sessionID: SessionSchema.ID) => Effect.Effect<SessionGoalSchema.State>
  readonly update: (
    sessionID: SessionSchema.ID,
    input: UpdateInput,
  ) => Effect.Effect<SessionGoalSchema.Snapshot, ConflictError>
  readonly replaceTodo: (
    sessionID: SessionSchema.ID,
    todos: ReadonlyArray<SessionGoalSchema.TodoInput>,
    expected?: Expected,
  ) => Effect.Effect<void, ConflictError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const bus = yield* Bus.Service
    const execution = yield* SessionExecution.Service
    const activation = yield* SessionGoalActivation.Service

    const readState = Effect.fn("SessionGoal.readState")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(SessionGoalTable)
        .where(eq(SessionGoalTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return {
        goal: row ? fromRow(row) : undefined,
        createdAt: row?.time_created,
        rounds: row?.rounds ?? 0,
        maxGoalRounds: row?.max_goal_rounds ?? DefaultMaxGoalRounds,
        armed: yield* activation.isArmed(sessionID),
        todo: yield* readTodo(db, sessionID),
      }
    })

    // The CAS reads the goal and publishes its successor in two steps. The
    // per-session lock keeps a concurrent mutation from slipping between them, so
    // two updates carrying the same token cannot both pass.
    const locks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

    const update = Effect.fn("SessionGoal.update")(function* (sessionID: SessionSchema.ID, input: UpdateInput) {
      const current = yield* read(db, sessionID)
      const expected =
        input.expectedRevision === undefined
          ? undefined
          : { revision: input.expectedRevision, goalID: input.expectedGoalID }
      if (expected && stale(current, expected))
        return yield* new ConflictError({
          message: `Goal changed: expected ${expected.goalID ?? "none"}@${expected.revision}, found ${current?.id ?? "none"}@${current?.revision ?? "none"}`,
        })
      if (input.action === "set") {
        const snapshot: SessionGoalSchema.Snapshot = {
          id: SessionGoalSchema.ID.create(),
          revision: 1,
          objective: yield* requireObjective(input),
          phase: "active",
          maxGoalRounds: DefaultMaxGoalRounds,
        }
        yield* publishUpdated(bus, sessionID, snapshot)
        yield* activation.arm(sessionID)
        return snapshot
      }
      const goal = yield* requireGoal(current)
      if (input.action === "edit") {
        yield* requirePhase(goal, input.action, ["active", "paused"])
        const snapshot = { ...goal, revision: goal.revision + 1, objective: yield* requireObjective(input) }
        yield* publishUpdated(bus, sessionID, snapshot)
        return snapshot
      }
      if (input.action === "pause") {
        yield* requirePhase(goal, input.action, ["active"])
        // Disarm first: it is the only action that stops the goal immediately, and
        // it commits separately from the durable phase. Then cancel the running turn,
        // but only a goal this process was actually driving: the phase guard already
        // guarantees `active`, so `armed` is the remaining signal.
        const armed = yield* activation.isArmed(sessionID)
        yield* activation.disarm(sessionID)
        const snapshot = { ...goal, revision: goal.revision + 1, phase: "paused" as const }
        yield* publishUpdated(bus, sessionID, snapshot)
        if (armed) yield* Effect.uninterruptible(execution.interrupt(sessionID))
        return snapshot
      }
      if (input.action === "resume") {
        yield* requirePhase(goal, input.action, ["paused"])
        const snapshot = { ...goal, revision: goal.revision + 1, phase: "active" as const }
        yield* publishUpdated(bus, sessionID, snapshot)
        yield* activation.arm(sessionID)
        return snapshot
      }
      yield* activation.disarm(sessionID)
      yield* bus.publish(SessionEvent.Goal.Cleared, {
        sessionID,
        goalID: goal.id,
        revision: goal.revision + 1,
      })
      return { ...goal, revision: goal.revision + 1 }
    })

    const replaceTodo = Effect.fn("SessionGoal.replaceTodo")(function* (
      sessionID: SessionSchema.ID,
      todos: ReadonlyArray<SessionGoalSchema.TodoInput>,
      expected?: Expected,
    ) {
      const goal = yield* requireGoal(yield* read(db, sessionID))
      if (expected && stale(goal, expected))
        return yield* new ConflictError({
          message: `Goal changed: expected ${expected.goalID ?? "none"}@${expected.revision}, found ${goal.id}@${goal.revision}`,
        })
      yield* bus.publish(SessionEvent.Todo.Updated, { sessionID, revision: goal.revision + 1, todos })
    })

    return Service.of({
      read: (sessionID) => read(db, sessionID),
      readTodo: (sessionID) => readTodo(db, sessionID),
      readState,
      update: (sessionID, input) => locks.withLock(sessionID)(update(sessionID, input)),
      replaceTodo: (sessionID, todos, expected) => locks.withLock(sessionID)(replaceTodo(sessionID, todos, expected)),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Bus.node, SessionExecution.node, SessionGoalActivation.node],
})

function requireGoal(goal: SessionGoalSchema.Snapshot | undefined) {
  return goal ? Effect.succeed(goal) : Effect.fail(new ConflictError({ message: "No goal is set for this session" }))
}

/** True when the client's CAS token no longer matches the durable goal. */
function stale(goal: SessionGoalSchema.Snapshot | undefined, expected: Expected) {
  return goal?.revision !== expected.revision || goal?.id !== expected.goalID
}

/** Rejects an action the goal's durable phase does not allow. */
function requirePhase(
  goal: SessionGoalSchema.Snapshot,
  action: UpdateInput["action"],
  allowed: ReadonlyArray<SessionGoalSchema.Phase>,
) {
  return allowed.includes(goal.phase)
    ? Effect.void
    : Effect.fail(new ConflictError({ message: `Goal action "${action}" is not allowed in phase "${goal.phase}"` }))
}

function requireObjective(input: UpdateInput) {
  return input.objective !== undefined && input.objective.length > 0
    ? Effect.succeed(input.objective)
    : Effect.fail(new ConflictError({ message: `Goal action "${input.action}" requires an objective` }))
}

function publishUpdated(bus: Bus.Interface, sessionID: SessionSchema.ID, snapshot: SessionGoalSchema.Snapshot) {
  return bus.publish(SessionEvent.Goal.Updated, { sessionID, snapshot })
}
