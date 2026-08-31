export * as Recall from "./indexer"

import { and, eq, inArray, sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer, Stream } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { Flag } from "../flag/flag"
import { SessionV1, type PartID } from "../v1/session"
import type { SessionSchema } from "../session/schema"

type SessionID = SessionSchema.ID
import { MessageTable, PartTable, SessionTable } from "../session/sql"
import { RecallChunkTable } from "./sql"
import { cosine, HashingProvider, textHash, type EmbeddingProvider } from "./provider"

const CHUNK_CHARS = 1200
const FLUSH_MILLIS = 2000

export interface Hit {
  readonly sessionID: string
  readonly messageID: string
  readonly partID: string
  readonly text: string
  readonly score: number
}

export interface Interface {
  /** Semantic recall over indexed transcript chunks. Empty when the feature flag is off. */
  readonly search: (input: { query: string; limit?: number }) => Effect.Effect<Hit[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Recall") {}

interface PartRow {
  id: PartID
  message_id: string
  session_id: string
  data: unknown
}

function isIndexableText(row: PartRow): row is PartRow & { data: { type: "text"; text: string } } {
  const data = row.data as { type?: string; text?: unknown; synthetic?: boolean; ignored?: boolean }
  return (
    data.type === "text" &&
    !data.synthetic &&
    !data.ignored &&
    typeof data.text === "string" &&
    data.text.trim().length > 0
  )
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text]
  const pieces: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_CHARS) pieces.push(text.slice(i, i + CHUNK_CHARS))
  return pieces
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const provider: EmbeddingProvider = HashingProvider
    // Read at boot; flipping the env var requires a restart, which keeps the
    // index lifecycle deterministic for the process.
    const enabled = Flag.OPENCODE_EXPERIMENTAL_TRANSCRIPT_RECALL

    const deletePart = (partID: PartID) =>
      db.delete(RecallChunkTable).where(eq(RecallChunkTable.part_id, partID)).run().pipe(Effect.orDie)

    const deleteMessage = (input: { sessionID: string; messageID: string }) =>
      db
        .delete(RecallChunkTable)
        .where(
          and(eq(RecallChunkTable.session_id, input.sessionID), eq(RecallChunkTable.message_id, input.messageID)),
        )
        .run()
        .pipe(Effect.orDie)

    const deleteSession = (sessionID: string) =>
      db.delete(RecallChunkTable).where(eq(RecallChunkTable.session_id, sessionID)).run().pipe(Effect.orDie)

    // Re-index the current committed state of the given parts. The event only
    // marks parts dirty; the part table is always the source of truth, which
    // naturally collapses streaming churn into one final write per flush.
    const indexParts = (partIDs: PartID[]) =>
      Effect.gen(function* () {
        if (partIDs.length === 0) return
        const rows = (yield* db.select().from(PartTable).where(inArray(PartTable.id, partIDs)).all().pipe(
          Effect.orDie,
        )) as PartRow[]
        const stale = rows.filter((row) => !isIndexableText(row))
        for (const row of stale) yield* deletePart(row.id)
        const candidates = rows.filter(isIndexableText)
        for (const row of candidates) {
          const existing = yield* db
            .select({ id: RecallChunkTable.id, text_hash: RecallChunkTable.text_hash })
            .from(RecallChunkTable)
            .where(eq(RecallChunkTable.part_id, row.id))
            .all()
            .pipe(Effect.orDie)
          const keep = new Set<string>()
          const pieces = chunkText(row.data.text)
          let changed = false
          for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i]
            const hash = textHash(piece)
            const id = `${row.id}:${i}`
            keep.add(id)
            if (existing.some((entry) => entry.id === id && entry.text_hash === hash)) continue
            changed = true
            const vectors = yield* provider.embed([piece])
            const values = {
              id,
              session_id: row.session_id,
              message_id: row.message_id,
              part_id: row.id,
              chunk_index: i,
              provider: provider.id,
              dim: provider.dim,
              model_id: provider.modelID,
              text_hash: hash,
              text: piece,
              vec: Buffer.from(vectors[0].buffer, vectors[0].byteOffset, vectors[0].byteLength),
            }
            yield* db
              .insert(RecallChunkTable)
              .values(values)
              .onConflictDoUpdate({ target: RecallChunkTable.id, set: values })
              .run()
              .pipe(Effect.orDie)
          }
          const removed = existing.filter((entry) => !keep.has(entry.id)).map((entry) => entry.id)
          if (removed.length > 0) {
            yield* db.delete(RecallChunkTable).where(inArray(RecallChunkTable.id, removed)).run().pipe(Effect.orDie)
          }
          if (!changed && removed.length === 0) continue
        }
      })

    const touched = new Set<PartID>()
    const touchedSessions = new Set<SessionID>()

    // One anchor chunk per session holding its title plus any compaction
    // summaries. Gives aggregate queries ("what did we decide about X?") a
    // high-precision entry point that plain per-part chunks lack.
    const indexSessionMeta = (sessionIDs: SessionID[]) =>
      Effect.gen(function* () {
        for (const sessionID of sessionIDs) {
          const metaID = `meta:${sessionID}`
          const sessionRow = yield* db
            .select({ title: SessionTable.title })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get()
            .pipe(Effect.orDie)
          const summaries = yield* db
            .select({ data: MessageTable.data })
            .from(MessageTable)
            .where(
              and(
                eq(MessageTable.session_id, sessionID),
                sql`json_extract(${MessageTable.data}, '$.summary.body') IS NOT NULL`,
              ),
            )
            .all()
            .pipe(Effect.orDie)
          const pieces: string[] = []
          if (sessionRow?.title) pieces.push(`Session title: ${sessionRow.title}`)
          for (const row of summaries) {
            const summary = (row.data as { summary?: { title?: string; body?: string } }).summary
            if (summary?.title) pieces.push(`Summary title: ${summary.title}`)
            if (summary?.body) pieces.push(summary.body)
          }
          if (pieces.length === 0) {
            yield* db.delete(RecallChunkTable).where(eq(RecallChunkTable.id, metaID)).run().pipe(Effect.orDie)
            continue
          }
          const text = pieces.join("\n\n")
          const hash = textHash(text)
          const existing = yield* db
            .select({ text_hash: RecallChunkTable.text_hash })
            .from(RecallChunkTable)
            .where(eq(RecallChunkTable.id, metaID))
            .get()
            .pipe(Effect.orDie)
          if (existing?.text_hash === hash) continue
          const vectors = yield* provider.embed([text])
          const values = {
            id: metaID,
            session_id: sessionID,
            message_id: "meta",
            part_id: sessionID,
            chunk_index: 0,
            provider: provider.id,
            dim: provider.dim,
            model_id: provider.modelID,
            text_hash: hash,
            text,
            vec: Buffer.from(vectors[0].buffer, vectors[0].byteOffset, vectors[0].byteLength),
          }
          yield* db
            .insert(RecallChunkTable)
            .values(values)
            .onConflictDoUpdate({ target: RecallChunkTable.id, set: values })
            .run()
            .pipe(Effect.orDie)
        }
      })

    if (enabled) {
      // Backfill: anything in the part table without chunks yet. Chunks are
      // keyed deterministically, so overlap with live indexing is harmless.
      yield* Effect.gen(function* () {
        const indexed = yield* db
          .selectDistinct({ part_id: RecallChunkTable.part_id })
          .from(RecallChunkTable)
          .all()
          .pipe(Effect.orDie)
        const known = new Set(indexed.map((row) => row.part_id))
        const parts = yield* db.select({ id: PartTable.id }).from(PartTable).all().pipe(Effect.orDie)
        const missing = parts.map((part) => part.id).filter((id) => !known.has(id))
        for (let i = 0; i < missing.length; i += 50) {
          yield* indexParts(missing.slice(i, i + 50))
        }
        const sessions = yield* db.selectDistinct({ id: PartTable.session_id }).from(PartTable).all().pipe(Effect.orDie)
        yield* indexSessionMeta(sessions.map((row) => row.id))
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("recall backfill failed", { cause: String(cause) }).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      )

      yield* events.subscribe(SessionV1.Event.PartUpdated).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            touched.add(event.data.part.id)
            touchedSessions.add(event.data.part.sessionID)
          }),
        ),
        Effect.forkScoped,
      )
      yield* events.subscribe(SessionV1.Event.Updated).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            touchedSessions.add(event.data.info.id)
          }),
        ),
        Effect.forkScoped,
      )
      yield* events.subscribe(SessionV1.Event.PartRemoved).pipe(
        Stream.runForEach((event) => deletePart(event.data.partID)),
        Effect.forkScoped,
      )
      yield* events.subscribe(SessionV1.Event.MessageRemoved).pipe(
        Stream.runForEach((event) => deleteMessage(event.data)),
        Effect.forkScoped,
      )
      yield* events.subscribe(SessionV1.Event.Deleted).pipe(
        Stream.runForEach((event) => deleteSession(event.data.sessionID)),
        Effect.forkScoped,
      )
      yield* Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(FLUSH_MILLIS))
          if (touched.size === 0 && touchedSessions.size === 0) return
          const batch = [...touched]
          const sessions = [...touchedSessions]
          touched.clear()
          touchedSessions.clear()
          yield* Effect.all([
            indexParts(batch).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("recall index flush failed", { cause: String(cause) }).pipe(Effect.asVoid),
              ),
            ),
            indexSessionMeta(sessions).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("recall meta flush failed", { cause: String(cause) }).pipe(Effect.asVoid),
              ),
            ),
          ], { discard: true })
        }),
      ).pipe(Effect.forkScoped)
    }

    const search: Interface["search"] = ({ query, limit }) =>
      Effect.gen(function* () {
        if (!enabled) return []
        const trimmed = query.trim()
        if (!trimmed) return []
        const vectors = yield* provider.embed([trimmed])
        const rows = yield* db.select().from(RecallChunkTable).all().pipe(Effect.orDie)
        const scored: Hit[] = []
        for (const row of rows) {
          if (row.dim !== provider.dim || row.provider !== provider.id) continue
          const bytes = new Uint8Array(row.vec)
          const copy = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
          scored.push({
            sessionID: row.session_id,
            messageID: row.message_id,
            partID: row.part_id,
            text: row.text,
            score: cosine(vectors[0], copy),
          })
        }
        scored.sort((a, b) => b.score - a.score)
        return scored.slice(0, limit ?? 5)
      })

    return Service.of({ search })
  }),
)

export const node = makeGlobalNode({ name: "transcript-recall", layer, deps: [EventV2.node, Database.node] })
