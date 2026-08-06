export * as SessionPending from "./pending"

import { and, asc, eq, or } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import {
  Compaction,
  Delivery,
  Info,
  Message,
  Synthetic,
  SyntheticData,
  User,
  UserData,
} from "@opencode-ai/schema/session-pending"
import type { Database } from "../database/database"
import { Bus } from "../bus"
import { KeyedMutex } from "../effect/keyed-mutex"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionPendingTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Compaction, Delivery, Info, Message, Synthetic, SyntheticData, User, UserData }

/**
 * Which pending input `promote` may consume: "steer" promotes steers only (a step
 * boundary mid-work), while "input" also allows one queued input when no steers are
 * waiting (the idle boundary, where the Session picks up fresh work).
 */
export type Promotable = "input" | "steer"

const decodeUser = Schema.decodeUnknownSync(UserData)
const encodeUser = Schema.encodeSync(UserData)
const decodeSynthetic = Schema.decodeUnknownSync(SyntheticData)
const encodeSynthetic = Schema.encodeSync(SyntheticData)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)
const inboxLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()(
  "SessionPending.LifecycleConflict",
  {
    id: SessionMessage.ID,
  },
) {}

const fromRow = (row: typeof SessionPendingTable.$inferSelect): Info => {
  const base = {
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    timeCreated: DateTime.makeUnsafe(row.time_created),
  }
  if (row.type === "compaction") return Compaction.make({ ...base, type: "compaction" })
  if (!row.delivery) throw new LifecycleConflict({ id: base.id })
  if (row.type === "user")
    return User.make({
      ...base,
      type: "user",
      data: decodeUser(row.data),
      delivery: row.delivery,
    })
  if (row.type === "synthetic")
    return Synthetic.make({
      ...base,
      type: "synthetic",
      data: decodeSynthetic(row.data),
      delivery: row.delivery,
    })
  throw new LifecycleConflict({ id: base.id })
}

export const find = Effect.fn("SessionPending.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db
    .select()
    .from(SessionPendingTable)
    .where(eq(SessionPendingTable.id, id))
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const compaction = Effect.fn("SessionPending.compaction")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionPendingTable)
    .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.type, "compaction")))
    .orderBy(asc(SessionPendingTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const entry = fromRow(row)
  return entry.type === "compaction" ? entry : undefined
})

const promotedFromMessage = Effect.fn("SessionPending.promotedFromMessage")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, id))
    .get()
    .pipe(Effect.orDie)
  if (row === undefined) return undefined
  if (row.session_id !== sessionID || (row.type !== "user" && row.type !== "synthetic"))
    return yield* Effect.die(new LifecycleConflict({ id }))
  const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
  const base = { id, sessionID, timeCreated: message.time.created, delivery }
  if (message.type === "user")
    return User.make({
      ...base,
      type: "user",
      data: decodeUser(message),
    })
  if (message.type === "synthetic")
    return Synthetic.make({
      ...base,
      type: "synthetic",
      data: decodeSynthetic(message),
    })
  return yield* Effect.die(new LifecycleConflict({ id }))
})

export const admit = Effect.fn("SessionPending.admit")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  request: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly input: Message
  },
) {
  const existing = yield* find(db, request.id)
  if (existing !== undefined) {
    if (existing.type === "compaction") return yield* Effect.die(new LifecycleConflict({ id: request.id }))
    return existing
  }
  const promoted = yield* promotedFromMessage(db, request.sessionID, request.id, request.input.delivery)
  if (promoted !== undefined) return promoted
  return yield* bus
    .publish(SessionEvent.InputAdmitted, {
      inputID: request.id,
      sessionID: request.sessionID,
      input: request.input,
    })
    .pipe(
      Effect.flatMap((event) => {
        const base = {
          id: request.id,
          sessionID: request.sessionID,
          timeCreated: event.created,
        }
        return Effect.succeed(
          request.input.type === "user"
            ? User.make({ ...base, ...request.input })
            : Synthetic.make({ ...base, ...request.input }),
        )
      }),
      Effect.catchDefect((defect) =>
        find(db, request.id).pipe(
          Effect.flatMap((stored) =>
            stored?.type === request.input.type ? Effect.succeed(stored) : Effect.die(defect),
          ),
        ),
      ),
    )
})

export const admitCompaction = Effect.fn("SessionPending.admitCompaction")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  input: { readonly id: SessionMessage.ID; readonly sessionID: SessionSchema.ID },
) {
  return yield* inboxLocks.withLock(input.sessionID)(
    Effect.gen(function* () {
      const exact = yield* find(db, input.id)
      if (exact) {
        if (exact.type === "compaction" && exact.sessionID === input.sessionID) return exact
        return yield* Effect.die(new LifecycleConflict({ id: input.id }))
      }
      const pending = yield* compaction(db, input.sessionID)
      if (pending) return pending
      return yield* bus
        .publish(SessionEvent.Compaction.Admitted, {
          inputID: input.id,
          sessionID: input.sessionID,
        })
        .pipe(
          Effect.flatMap((event) => {
            if (event.durable === undefined)
              return Effect.die(new Error("Compaction admission event is missing aggregate sequence"))
            return compaction(db, input.sessionID).pipe(
              Effect.flatMap((stored) =>
                stored ? Effect.succeed(stored) : Effect.die(new LifecycleConflict({ id: input.id })),
              ),
            )
          }),
          Effect.catchDefect((defect) =>
            compaction(db, input.sessionID).pipe(
              Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect))),
            ),
          ),
        )
    }),
  )
})

export const projectAdmitted = Effect.fn("SessionPending.projectAdmitted")(function* (
  db: DatabaseService,
  request: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly input: Message
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, request.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: request.id }))
  const stored = yield* db
    .insert(SessionPendingTable)
    .values({
      id: request.id,
      session_id: request.sessionID,
      type: request.input.type,
      data: request.input.type === "user" ? encodeUser(request.input.data) : encodeSynthetic(request.input.data),
      delivery: request.input.delivery,
      admitted_seq: request.admittedSeq,
      time_created: DateTime.toEpochMillis(request.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionPendingTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: request.id }))
})

export const projectCompactionAdmitted = Effect.fn("SessionPending.projectCompactionAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionPendingTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      type: "compaction",
      data: {},
      admitted_seq: input.admittedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (stored) {
    const entry = fromRow(stored)
    return entry.type === "compaction" ? entry : yield* Effect.die(new LifecycleConflict({ id: entry.id }))
  }
  const pending = yield* compaction(db, input.sessionID)
  if (pending) return pending
  return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

/**
 * Consume one pending row at promotion. The row's content feeds the projected
 * message insert inside the same event transaction; the deleted row is what
 * makes the table pending-only.
 */
export const projectPromoted = Effect.fn("SessionPending.projectPromoted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
  },
) {
  if (yield* compaction(db, input.sessionID)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const deleted = yield* db
    .delete(SessionPendingTable)
    .where(and(eq(SessionPendingTable.id, input.id), eq(SessionPendingTable.session_id, input.sessionID)))
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (!deleted) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = fromRow(deleted)
  if (stored.type === "compaction") return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  return stored
})

export const settleCompaction = Effect.fn("SessionPending.settleCompaction")(function* (
  db: DatabaseService,
  input: { readonly sessionID: SessionSchema.ID },
) {
  const deleted = yield* db
    .delete(SessionPendingTable)
    .where(and(eq(SessionPendingTable.session_id, input.sessionID), eq(SessionPendingTable.type, "compaction")))
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (deleted) {
    const stored = fromRow(deleted)
    return stored.type === "compaction" ? stored : yield* Effect.die(new LifecycleConflict({ id: stored.id }))
  }
  return undefined
})

export const list = Effect.fn("SessionPending.list")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select()
    .from(SessionPendingTable)
    .where(eq(SessionPendingTable.session_id, sessionID))
    .orderBy(asc(SessionPendingTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map(fromRow)
})

/**
 * Which pending rows count: "any" counts every row including compaction, while
 * delivery scopes are blocked behind a pending compaction barrier. "input" means
 * any model-facing input, steered or queued.
 */
export type Scope = "any" | "input" | Delivery

export const has = Effect.fn("SessionPending.has")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  scope: Scope,
) {
  if (scope !== "any" && (yield* compaction(db, sessionID))) return false
  const row = yield* db
    .select({ id: SessionPendingTable.id })
    .from(SessionPendingTable)
    .where(
      and(
        eq(SessionPendingTable.session_id, sessionID),
        scope === "any"
          ? undefined
          : scope === "input"
            ? or(eq(SessionPendingTable.delivery, "steer"), eq(SessionPendingTable.delivery, "queue"))
            : eq(SessionPendingTable.delivery, scope),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: User | Synthetic,
  expected: { readonly sessionID: SessionSchema.ID; readonly input: Message },
) => {
  if (
    input.type !== expected.input.type ||
    input.delivery !== expected.input.delivery ||
    input.sessionID !== expected.sessionID
  )
    return false
  if (input.type === "user" && expected.input.type === "user")
    return JSON.stringify(encodeUser(input.data)) === JSON.stringify(encodeUser(expected.input.data))
  if (input.type === "synthetic" && expected.input.type === "synthetic")
    return JSON.stringify(encodeSynthetic(input.data)) === JSON.stringify(encodeSynthetic(expected.input.data))
  return false
}

const publish = Effect.fn("SessionPending.publish")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionPendingTable.$inferSelect>,
) {
  if (yield* compaction(db, sessionID)) return 0
  yield* Effect.forEach(
    rows,
    (row) => {
      const entry = fromRow(row)
      if (entry.type === "compaction") return Effect.die(new LifecycleConflict({ id: entry.id }))
      return bus
        .publish(SessionEvent.InputPromoted, {
          sessionID,
          inputID: entry.id,
        })
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof LifecycleConflict
              ? promotedFromMessage(db, sessionID, entry.id, entry.delivery).pipe(
                  Effect.flatMap((stored) => (stored !== undefined ? Effect.void : Effect.die(defect))),
                )
              : Effect.die(defect),
          ),
        )
    },
    { discard: true },
  )
  return rows.length
})

/**
 * Promotes pending input into visible messages and returns the promoted count.
 * Steers always go first; only the "input" scope may fall through to one queued
 * input, and it then collects steers that arrived during promotion.
 */
export const promote = Effect.fn("SessionPending.promote")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  scope: Promotable,
) {
  return yield* inboxLocks.withLock(sessionID)(
    Effect.gen(function* () {
      if (yield* compaction(db, sessionID)) return 0
      const steers = yield* db
        .select()
        .from(SessionPendingTable)
        .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, "steer")))
        .orderBy(asc(SessionPendingTable.admitted_seq))
        .all()
        .pipe(Effect.orDie)
      if (steers.length > 0 || scope === "steer") return yield* publish(db, bus, sessionID, steers)

      const queued = yield* db
        .select()
        .from(SessionPendingTable)
        .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, "queue")))
        .orderBy(asc(SessionPendingTable.admitted_seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!queued) return 0
      const promoted = yield* publish(db, bus, sessionID, [queued])
      const arrivedSteers = yield* db
        .select()
        .from(SessionPendingTable)
        .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, "steer")))
        .orderBy(asc(SessionPendingTable.admitted_seq))
        .all()
        .pipe(Effect.orDie)
      return promoted + (yield* publish(db, bus, sessionID, arrivedSteers))
    }),
  )
})
