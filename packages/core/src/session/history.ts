import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionContextEpochTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

export const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
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

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const [epoch, compaction] = yield* Effect.all(
    [
      db
        .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
      latestCompaction(db, sessionID),
    ],
    { concurrency: "unbounded" },
  )
  return yield* Effect.forEach(yield* messageRows(db, sessionID, compaction, epoch?.baselineSeq), decodeMessageRow)
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, sessionID, baselineSeq)).map((entry) => entry.message)
})

const entriesFromV1 = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const msgRows = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
    .all()
    .pipe(Effect.orDie)

  if (msgRows.length === 0) return []

  const entries: { seq: number; message: SessionMessage.Message }[] = []
  let seq = 1
  for (const msgRow of msgRows) {
    const partRows = yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.message_id, msgRow.id))
      .orderBy(asc(PartTable.time_created), asc(PartTable.id))
      .all()
      .pipe(Effect.orDie)

    const rawId = msgRow.id.startsWith("msg_") ? msgRow.id : `msg_${msgRow.id}`

    if (msgRow.data.role === "user") {
      const text = partRows
        .filter((p) => p.data.type === "text")
        .map((p) => (p.data as { text?: string }).text ?? "")
        .join("\n")
      const rawUser = {
        id: rawId,
        type: "user" as const,
        text,
        files: [],
        agents: [],
        time: { created: msgRow.time_created },
      }
      const message = yield* decode(rawUser).pipe(Effect.orDie)
      entries.push({ seq: seq++, message })
    } else if (msgRow.data.role === "assistant") {
      const content: unknown[] = []
      for (const p of partRows) {
        if (p.data.type === "text") {
          content.push({
            type: "text",
            id: p.id,
            text: (p.data as { text?: string }).text ?? "",
          })
        } else if (p.data.type === "reasoning") {
          content.push({
            type: "reasoning",
            id: p.id,
            text: (p.data as { text?: string }).text ?? "",
          })
        } else if (p.data.type === "tool") {
          const toolData = p.data as {
            tool?: string
            state?: {
              status?: string
              input?: Record<string, unknown>
              output?: unknown
              error?: string
            }
          }
          let state: unknown
          if (toolData.state?.status === "completed") {
            const outStr =
              typeof toolData.state.output === "string"
                ? toolData.state.output
                : JSON.stringify(toolData.state.output ?? "")
            state = {
              status: "completed",
              input: toolData.state.input ?? {},
              structured: {},
              content: [{ type: "text", text: outStr }],
            }
          } else if (toolData.state?.status === "error") {
            state = {
              status: "error",
              input: toolData.state.input ?? {},
              structured: {},
              content: [],
              error: { type: "unknown", message: toolData.state.error ?? "Tool execution failed" },
            }
          } else {
            state = {
              status: "pending",
              input: JSON.stringify(toolData.state?.input ?? {}),
            }
          }
          content.push({
            type: "tool",
            id: p.id,
            name: toolData.tool ?? "unknown",
            state,
            time: { created: p.time_created },
          })
        }
      }
      const assistantData = msgRow.data as {
        agent?: string
        modelID?: string
        providerID?: string
        time?: { created?: number; completed?: number }
      }
      const rawAssistant = {
        id: rawId,
        type: "assistant" as const,
        agent: assistantData.agent ?? "default",
        model: {
          id: assistantData.modelID ?? "default",
          providerID: assistantData.providerID ?? "default",
        },
        content,
        time: {
          created: msgRow.time_created,
          completed: assistantData.time?.completed,
        },
      }
      const message = yield* decode(rawAssistant).pipe(Effect.orDie)
      entries.push({ seq: seq++, message })
    }
  }
  return entries
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  if (rows.length > 0) {
    return yield* Effect.forEach(rows, (row) =>
      decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
    )
  }
  return yield* entriesFromV1(db, sessionID)
})

export * as SessionHistory from "./history"
