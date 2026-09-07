import { and, eq, gte, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database.js"
import { MessageDecodeError } from "./error.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { Instructions } from "../instructions/index.js"
import { InstructionState } from "./instruction-state.js"
import { SessionMessageTable } from "./sql.js"
import { Timeline } from "./timeline.js"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Info)

export const latestCompaction = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  ranges?: readonly Timeline.Range[],
) {
  const [row] = yield* Timeline.rows(db, ranges ?? (yield* Timeline.forSession(db, sessionID)), {
    where: and(
      eq(SessionMessageTable.type, "compaction"),
      sql`json_extract(${SessionMessageTable.data}, '$.status') = 'completed'`,
    ),
    limit: 1,
  })
  return row
})

export const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
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
  const ranges = yield* Timeline.forSession(db, sessionID)
  const compaction = yield* latestCompaction(db, sessionID, ranges)
  const rows = yield* Timeline.rows(db, ranges, {
    where: compaction ? gte(SessionMessageTable.seq, compaction.seq) : undefined,
    order: "asc",
  })
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
  instructions: Instructions.List,
) {
  return yield* db
    .transaction(() =>
      Effect.gen(function* () {
        const messages = yield* messageEntries(db, sessionID)
        return {
          initial: yield* InstructionState.initial(db, sessionID, instructions),
          entries: messages,
        }
      }),
    )
    .pipe(Effect.orDie)
})

export const preview = Effect.fn("SessionHistory.preview")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  instructions: Instructions.List,
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
        return {
          initial: assembled.initial,
          messages: settled.map((entry) => entry.message),
          instructionUpdate: assembled.update,
        }
      }),
    )
    .pipe(Effect.catch((error) => (error instanceof Instructions.InitializationBlocked ? error : Effect.die(error))))
})

/** Returns the session's first user message. */
export const firstUserMessage = Effect.fn("SessionHistory.firstUserMessage")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const [row] = yield* Timeline.rows(db, yield* Timeline.forSession(db, sessionID), {
    where: eq(SessionMessageTable.type, "user"),
    order: "asc",
    limit: 1,
  })
  if (!row) return undefined
  const message = yield* decodeMessageRow(row).pipe(Effect.orElseSucceed(() => undefined))
  return message?.type === "user" ? message : undefined
})

export * as SessionHistory from "./history.js"
