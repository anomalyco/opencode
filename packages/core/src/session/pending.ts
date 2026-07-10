export * as SessionPending from "./pending"

import { and, asc, eq } from "drizzle-orm"
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
import { Event } from "@opencode-ai/schema/event"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { KeyedMutex } from "../effect/keyed-mutex"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionPendingTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Compaction, Delivery, Info, Message, Synthetic, SyntheticData, User, UserData }

const decodeUser = Schema.decodeUnknownSync(UserData)
const encodeUser = Schema.encodeSync(UserData)
const decodeSynthetic = Schema.decodeUnknownSync(SyntheticData)
const encodeSynthetic = Schema.encodeSync(SyntheticData)
const decodeAdmittedEvent = Schema.decodeUnknownOption(SessionEvent.InputAdmitted.data)
const admittedEventType = Event.versionedType(
  SessionEvent.InputAdmitted.type,
  SessionEvent.InputAdmitted.durable.version,
)
const inboxLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()(
  "SessionPending.LifecycleConflict",
  {
    id: SessionMessage.ID,
  },
) {}

const fromRow = (row: typeof SessionPendingTable.$inferSelect): Info => {
  const base = {
    admittedSeq: row.admitted_seq,
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

/**
 * Reconstruct the admitted record for a pending row that was already consumed
 * by promotion. The projected `session_message` row proves promotion happened;
 * the durable `session.input.admitted` event retains the exact admitted
 * message, including delivery.
 */
const promotedFromHistory = Effect.fn("SessionPending.promotedFromHistory")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
) {
  const message = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, id))
    .get()
    .pipe(Effect.orDie)
  if (message === undefined) return undefined
  if (message.session_id !== sessionID || (message.type !== "user" && message.type !== "synthetic"))
    return yield* Effect.die(new LifecycleConflict({ id }))
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, admittedEventType)))
    .all()
    .pipe(Effect.orDie)
  for (const row of rows) {
    const decoded = decodeAdmittedEvent(row.data)
    if (decoded._tag !== "Some" || decoded.value.inputID !== id) continue
    const base = {
      admittedSeq: row.seq,
      id,
      sessionID,
      timeCreated: DateTime.makeUnsafe(row.created),
    }
    return decoded.value.input.type === "user"
      ? User.make({ ...base, ...decoded.value.input })
      : Synthetic.make({ ...base, ...decoded.value.input })
  }
  // A projected message without an admitted event in this aggregate (for
  // example fork-copied history) is not a retryable admission.
  return yield* Effect.die(new LifecycleConflict({ id }))
})

export const admit = Effect.fn("SessionPending.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
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
  const promoted = yield* promotedFromHistory(db, request.sessionID, request.id)
  if (promoted !== undefined) return promoted
  return yield* events
    .publish(SessionEvent.InputAdmitted, {
      inputID: request.id,
      sessionID: request.sessionID,
      input: request.input,
    })
    .pipe(
      Effect.flatMap((event) => {
        if (event.durable === undefined)
          return Effect.die(new Error("Session input admission event is missing aggregate sequence"))
        const base = {
          admittedSeq: event.durable.seq,
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
  events: EventV2.Interface,
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
      return yield* events
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

export const has = Effect.fn("SessionPending.has")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  if (yield* compaction(db, sessionID)) return false
  const row = yield* db
    .select({ id: SessionPendingTable.id })
    .from(SessionPendingTable)
    .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, delivery)))
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
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionPendingTable.$inferSelect>,
) {
  return yield* inboxLocks.withLock(sessionID)(
    Effect.gen(function* () {
      if (yield* compaction(db, sessionID)) return 0
      yield* Effect.forEach(
        rows,
        (row) => {
          const entry = fromRow(row)
          if (entry.type === "compaction") return Effect.die(new LifecycleConflict({ id: entry.id }))
          return events
            .publish(SessionEvent.InputPromoted, {
              sessionID,
              inputID: entry.id,
            })
            .pipe(
              Effect.catchDefect((defect) =>
                defect instanceof LifecycleConflict
                  ? promotedFromHistory(db, sessionID, entry.id).pipe(
                      Effect.flatMap((stored) => (stored !== undefined ? Effect.void : Effect.die(defect))),
                    )
                  : Effect.die(defect),
              ),
            )
        },
        { discard: true },
      )
      return rows.length
    }),
  )
})

export const promoteSteers = Effect.fn("SessionPending.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  if (yield* compaction(db, sessionID)) return 0
  const rows = yield* db
    .select()
    .from(SessionPendingTable)
    .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, "steer")))
    .orderBy(asc(SessionPendingTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionPending.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  if (yield* compaction(db, sessionID)) return false
  const row = yield* db
    .select()
    .from(SessionPendingTable)
    .where(and(eq(SessionPendingTable.session_id, sessionID), eq(SessionPendingTable.delivery, "queue")))
    .orderBy(asc(SessionPendingTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})
