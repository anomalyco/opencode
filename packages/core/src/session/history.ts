import { and, asc, desc, eq, gte, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Instructions } from "../instructions/index"
import { InstructionState } from "./instruction-state"
import { SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Info)

export const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "compaction"),
        sql`json_extract(${SessionMessageTable.data}, '$.status') = 'completed'`,
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction ? gte(SessionMessageTable.seq, compaction.seq) : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
  decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )

const messageEntries = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID))
  return yield* Effect.forEach(rows, (row) =>
    decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
  )
})

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return (yield* messageEntries(db, sessionID)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.Instructions,
) {
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const messages = yield* messageEntries(db, sessionID)
        const assembled = yield* InstructionState.assemble(db, sessionID, instructions)
        return {
          initial: assembled.initial,
          entries: [...messages, ...assembled.updates].toSorted((a, b) => a.seq - b.seq),
        }
      }),
    )
    .pipe(Effect.orDie)
})

export const preview = Effect.fn("SessionHistory.preview")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.Instructions,
) {
  const observed = yield* Instructions.read(instructions)
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const messages = yield* messageEntries(db, sessionID)
        // An active assistant may contain an unresolved tool call, so only preview the settled prefix.
        const unsettled = messages.findIndex(
          (entry) => entry.message.type === "assistant" && entry.message.time.completed === undefined,
        )
        const settled = unsettled === -1 ? messages : messages.slice(0, unsettled)
        const assembled = yield* InstructionState.preview(db, sessionID, instructions, observed)
        const entries = [...settled, ...assembled.updates].toSorted((a, b) => a.seq - b.seq)
        return {
          initial: assembled.initial,
          messages: entries.map((entry) => entry.message),
          instructionUpdate: assembled.update,
        }
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Instructions.InitializationBlocked ? error : Effect.die(error))))
})

/** Returns the session's sole user message, or `undefined` once a second one exists. */
export const firstUserMessageIfOnly = Effect.fn("SessionHistory.firstUserMessageIfOnly")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
    .orderBy(asc(SessionMessageTable.seq))
    .limit(2)
    .all()
    .pipe(Effect.orDie)
  if (rows.length !== 1) return undefined
  const message = yield* decodeMessageRow(rows[0]).pipe(Effect.catch(() => Effect.succeed(undefined)))
  return message?.type === "user" ? message : undefined
})

export * as SessionHistory from "./history"
