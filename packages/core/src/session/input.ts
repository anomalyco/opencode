export * as SessionInput from "./input"

import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { V2Schema } from "../v2-schema"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export const Delivery = Schema.Literals(["steer", "queue"])
export type Delivery = typeof Delivery.Type

export class Admitted extends Schema.Class<Admitted>("SessionInput.Admitted")({
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: V2Schema.DateTimeUtcFromMillis,
  promotedSeq: Schema.Int.pipe(Schema.optional),
}) {}

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  new Admitted({
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
  const row = yield* db
    .insert(SessionInputTable)
    .values({ id: input.id, session_id: input.sessionID, prompt: encodePrompt(input.prompt), delivery: input.delivery })
    .onConflictDoNothing()
    .returning()
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? yield* find(db, input.id) : fromRow(row)
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

export const latestPendingQueueSeq = Effect.fn("SessionInput.latestPendingQueueSeq")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select({ seq: SessionInputTable.seq })
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), eq(SessionInputTable.delivery, "queue"), isNull(SessionInputTable.promoted_seq)))
    .orderBy(desc(SessionInputTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row?.seq ?? undefined
})

export const equivalent = (input: Admitted, expected: {
  readonly sessionID: SessionSchema.ID
  readonly prompt: Prompt
  readonly delivery: Delivery
}) => input.sessionID === expected.sessionID && input.delivery === expected.delivery && Prompt.equivalence(input.prompt, expected.prompt)

export const promote = Effect.fn("SessionInput.promote")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  input: { readonly steer: boolean; readonly queueThrough?: number },
) {
  const eligible = or(
    input.steer ? eq(SessionInputTable.delivery, "steer") : undefined,
    input.queueThrough === undefined
      ? undefined
      : and(eq(SessionInputTable.delivery, "queue"), lte(SessionInputTable.seq, input.queueThrough)),
  )
  if (eligible === undefined) return 0
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq), eligible))
    .orderBy(asc(SessionInputTable.seq))
    .all()
    .pipe(Effect.orDie)
  for (const row of rows) {
    yield* events.publish(
      SessionEvent.Prompted,
      {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        prompt: decodePrompt(row.prompt),
      },
      { id: SessionMessage.ID.make(row.id) },
    )
  }
  return rows.length
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
