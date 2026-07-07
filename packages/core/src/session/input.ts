export * as SessionInput from "./input"

import { and, asc, eq, isNull } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Admitted, Compaction, Delivery, Info, PromptEntry } from "@opencode-ai/schema/session-input"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { KeyedMutex } from "../effect/keyed-mutex"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "@opencode-ai/schema/prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Compaction, Delivery, Info, PromptEntry }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)
const inboxLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

const fromRow = (row: typeof SessionInputTable.$inferSelect): Info => {
  const base = {
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    timeCreated: DateTime.makeUnsafe(row.time_created),
  }
  if (row.type === "compaction")
    return Compaction.make({
      ...base,
      type: "compaction",
      ...(row.promoted_seq === null ? {} : { handledSeq: row.promoted_seq }),
    })
  if (!row.prompt || !row.delivery) throw new LifecycleConflict({ id: base.id })
  return PromptEntry.make({
    ...base,
    type: "prompt",
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })
}

const toAdmitted = (entry: PromptEntry): Admitted =>
  Admitted.make({
    admittedSeq: entry.admittedSeq,
    id: entry.id,
    sessionID: entry.sessionID,
    prompt: entry.prompt,
    delivery: entry.delivery,
    timeCreated: entry.timeCreated,
    ...(entry.promotedSeq === undefined ? {} : { promotedSeq: entry.promotedSeq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const pendingCompaction = Effect.fn("SessionInput.pendingCompaction")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        eq(SessionInputTable.type, "compaction"),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const entry = fromRow(row)
  return entry.type === "compaction" ? entry : undefined
})

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) {
    if (existing.type !== "prompt") return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return toAdmitted(existing)
  }
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      inputID: input.id,
      sessionID: input.sessionID,
      prompt: input.prompt,
      delivery: input.delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die(new Error("Prompt admission event is missing aggregate sequence"))
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: event.created,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(
          Effect.flatMap((stored) =>
            stored?.type === "prompt" ? Effect.succeed(toAdmitted(stored)) : Effect.die(defect),
          ),
        ),
      ),
    )
})

export const admitCompaction = Effect.fn("SessionInput.admitCompaction")(function* (
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
      const pending = yield* pendingCompaction(db, input.sessionID)
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
            return pendingCompaction(db, input.sessionID).pipe(
              Effect.flatMap((stored) =>
                stored ? Effect.succeed(stored) : Effect.die(new LifecycleConflict({ id: input.id })),
              ),
            )
          }),
          Effect.catchDefect((defect) =>
            pendingCompaction(db, input.sessionID).pipe(
              Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect))),
            ),
          ),
        )
    }),
  )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
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
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      type: "prompt",
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectCompactionAdmitted = Effect.fn("SessionInput.projectCompactionAdmitted")(function* (
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
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      type: "compaction",
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
  const pending = yield* pendingCompaction(db, input.sessionID)
  if (pending) return pending
  return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPromptPromoted = Effect.fn("SessionInput.projectPromptPromoted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly promotedSeq: number
  },
) {
  if (yield* pendingCompaction(db, input.sessionID)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        eq(SessionInputTable.type, "prompt"),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (stored.type !== "prompt" || stored.sessionID !== input.sessionID)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return stored
  }
  const stored = yield* find(db, input.id)
  if (
    !stored ||
    stored.type !== "prompt" ||
    stored.sessionID !== input.sessionID ||
    stored.promotedSeq !== input.promotedSeq
  )
    return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  return stored
})

export const settleCompaction = Effect.fn("SessionInput.settleCompaction")(function* (
  db: DatabaseService,
  input: { readonly sessionID: SessionSchema.ID; readonly handledSeq: number },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.handledSeq })
    .where(
      and(
        eq(SessionInputTable.session_id, input.sessionID),
        eq(SessionInputTable.type, "compaction"),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    return stored.type === "compaction" ? stored : yield* Effect.die(new LifecycleConflict({ id: stored.id }))
  }
  return undefined
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  if (yield* pendingCompaction(db, sessionID)) return false
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        eq(SessionInputTable.type, "prompt"),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) =>
  input.delivery === expected.delivery &&
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  return yield* inboxLocks.withLock(sessionID)(
    Effect.gen(function* () {
      if (yield* pendingCompaction(db, sessionID)) return 0
      yield* Effect.forEach(
        rows,
        (row) => {
          const entry = fromRow(row)
          if (entry.type !== "prompt") return Effect.die(new LifecycleConflict({ id: entry.id }))
          return events
            .publish(SessionEvent.PromptPromoted, {
              sessionID,
              inputID: entry.id,
            })
            .pipe(
              Effect.catchDefect((defect) =>
                defect instanceof LifecycleConflict
                  ? find(db, entry.id).pipe(
                      Effect.flatMap((stored) =>
                        stored?.type === "prompt" && stored.promotedSeq !== undefined
                          ? Effect.void
                          : Effect.die(defect),
                      ),
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

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  if (yield* pendingCompaction(db, sessionID)) return 0
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        eq(SessionInputTable.type, "prompt"),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  if (yield* pendingCompaction(db, sessionID)) return false
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        eq(SessionInputTable.type, "prompt"),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})
