export * as SessionInput from "./input"

import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { NonNegativeInt, PositiveInt } from "../schema"
import { V2Schema } from "../v2-schema"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export const Delivery = Schema.Literals(["steer", "queue"])
export type Delivery = typeof Delivery.Type

export class Admitted extends Schema.Class<Admitted>("SessionInput.Admitted")({
  seq: PositiveInt,
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: V2Schema.DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(Schema.optional),
}) {}

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  new Admitted({
    seq: row.seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  return yield* db
    .transaction(
      () =>
        Effect.gen(function* () {
          const existing = yield* find(db, input.id)
          if (existing !== undefined) return existing
          const event = yield* db
            .select({ id: EventTable.id })
            .from(EventTable)
            .where(eq(EventTable.id, input.id))
            .get()
            .pipe(Effect.orDie)
          const message = yield* db
            .select({ id: SessionMessageTable.id })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.id, input.id))
            .get()
            .pipe(Effect.orDie)
          if (event !== undefined || message !== undefined) return undefined
          const row = yield* db
            .insert(SessionInputTable)
            .values({
              id: input.id,
              session_id: input.sessionID,
              prompt: encodePrompt(input.prompt),
              delivery: input.delivery,
            })
            .returning()
            .get()
            .pipe(Effect.orDie)
          return fromRow(row)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  deliveries: ReadonlyArray<Delivery> = ["steer", "queue"],
) {
  if (deliveries.length === 0) return false
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        inArray(SessionInputTable.delivery, deliveries),
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
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

export const guardReservedID = Effect.fn("SessionInput.guardReservedID")(function* (
  db: DatabaseService,
  event: EventV2.Payload,
) {
  const admitted = yield* find(db, event.id)
  if (admitted === undefined) return
  if (!Schema.is(SessionEvent.Prompted)(event))
    return yield* Effect.die("Durable event conflicts with admitted prompt input")
  if (!equivalent(admitted, event.data)) return yield* Effect.die("Prompt projection conflicts with admitted input")
})

export const project = Effect.fn("SessionInput.project")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const admitted = yield* find(db, input.id)
  if (admitted === undefined || admitted.delivery !== input.delivery || !matchesPrompt(admitted, input))
    return yield* Effect.die("Prompt projection conflicts with admitted input")
  yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .run()
    .pipe(Effect.orDie)
  return yield* find(db, input.id)
})

export const reconcileProjected = Effect.fn("SessionInput.reconcileProjected")(function* (
  db: DatabaseService,
  expected: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  if (expected.delivery !== "steer") return undefined
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, expected.id))
    .get()
    .pipe(Effect.orDie)
  if (row === undefined || row.session_id !== expected.sessionID || row.type !== "user") return undefined
  const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
  if (message.type !== "user" || !Prompt.equivalence(Prompt.fromUserMessage(message), expected.prompt)) return undefined
  return yield* project(db, {
    id: expected.id,
    sessionID: expected.sessionID,
    prompt: expected.prompt,
    delivery: expected.delivery,
    timeCreated: message.time.created,
    promotedSeq: row.seq,
  })
})

const publish = Effect.fn("SessionInput.publish")(function* (
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  for (const row of rows) {
    yield* events.publish(
      SessionEvent.Prompted,
      {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        prompt: decodePrompt(row.prompt),
        delivery: row.delivery,
      },
      { id: SessionMessage.ID.make(row.id) },
    )
  }
  return rows.length
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
      ),
    )
    .orderBy(asc(SessionInputTable.seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(events, sessionID, [row]).pipe(Effect.as(true))
})

export const toMessage = (input: Admitted) =>
  new SessionMessage.User({
    id: input.id,
    type: "user",
    text: input.prompt.text,
    files: input.prompt.files,
    agents: input.prompt.agents,
    references: input.prompt.references,
    time: { created: input.timeCreated },
  })
