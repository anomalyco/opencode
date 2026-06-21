import { Context, Effect, Layer, Option } from "effect"
import { Database } from "../database/database"
import { MemoryTable } from "./sql"
import { eq, desc } from "drizzle-orm"
import { Identifier } from "../util/identifier"
import { VectorCache, parseEmbeddingJson } from "./embedding"

export { getEmbedding, cosineSimilarity } from "./embedding"

export interface MemoryEntry {
  id: string
  content: string
  metadata: any
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly remember: (content: string, metadata?: any) => Effect.Effect<MemoryEntry>
  readonly recall: (query: string, limit?: number) => Effect.Effect<MemoryEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const cache = new VectorCache()

    return Service.of({
      remember: (content, metadata = {}) =>
        Effect.gen(function* () {
          const id = "mem_" + Identifier.ascending()
          const { getEmbedding } = yield* Effect.promise(() => import("./embedding"))
          const embeddingArray = yield* Effect.promise(() => getEmbedding(content))
          const embeddingStr = JSON.stringify(embeddingArray)
          const metadataStr = JSON.stringify(metadata)
          const now = Date.now()

          const row = {
            id,
            content,
            embedding: embeddingStr,
            metadata: metadataStr,
            time_created: now,
            time_updated: now,
          }

          yield* db.insert(MemoryTable).values(row).pipe(Effect.orDie)
          cache.upsert(id, embeddingArray, { content, metadata, time_created: now, time_updated: now })

          return {
            id,
            content,
            metadata,
            time_created: now,
            time_updated: now,
          }
        }),

      recall: (query, limit = 5) =>
        Effect.gen(function* () {
          const { getEmbedding, cosineSimilarity } = yield* Effect.promise(() => import("./embedding"))

          if (query === "") {
            const rows = yield* db
              .select()
              .from(MemoryTable)
              .orderBy(desc(MemoryTable.time_created))
              .limit(limit)
              .all()
              .pipe(Effect.orDie)

            return rows.map((row) => {
              const metadata = Option.try(() => row.metadata ? JSON.parse(row.metadata) : {}).pipe(Option.getOrElse(() => ({})))
              return {
                id: row.id,
                content: row.content,
                metadata,
                time_created: row.time_created,
                time_updated: row.time_updated,
              }
            })
          }

          const queryEmbedding = yield* Effect.promise(() => getEmbedding(query))

          // Use cache if it's populated and matches the DB size
          let rows: Array<Record<string, any>>
          if (cache.size > 0) {
            const hits = cache.search(queryEmbedding, limit)
            return hits.map((h) => h.payload as unknown as MemoryEntry)
          }

          // Cache miss — load all from DB
          rows = yield* db.select().from(MemoryTable).all().pipe(Effect.orDie)

          const scored = rows.map((row) => {
            const embedding = parseEmbeddingJson(row.embedding)
            const metadata = Option.try(() => row.metadata ? JSON.parse(row.metadata) : {}).pipe(Option.getOrElse(() => ({})))

            const score = embedding.length > 0 ? cosineSimilarity(queryEmbedding, embedding) : 0
            return { score, entry: { id: row.id, content: row.content, metadata, time_created: row.time_created, time_updated: row.time_updated } }
          })

          // Populate cache for future queries
          for (const row of rows) {
            const emb = parseEmbeddingJson(row.embedding)
            if (emb.length > 0) {
              const metadata = Option.try(() => row.metadata ? JSON.parse(row.metadata) : {}).pipe(Option.getOrElse(() => ({})))
              cache.upsert(row.id, emb, { content: row.content, metadata, time_created: row.time_created, time_updated: row.time_updated })
            }
          }

          return scored
            .filter((item) => item.score > 0.1)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((item) => item.entry)
        }),
    })
  }),
)
