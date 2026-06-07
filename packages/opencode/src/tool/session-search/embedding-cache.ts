import { Context, Effect, Layer, Option } from "effect"
import { eq, sql } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { SessionSearchEmbeddingTable } from "@opencode-ai/core/session/sql"
import { Config } from "@/config/config"

const DEFAULT_MAX_ENTRIES = 10000

export interface Interface {
  readonly get: (fingerprint: string, model: string) => Effect.Effect<Option.Option<Float32Array>>
  readonly set: (fingerprint: string, vector: number[], dimensions: number, model: string) => Effect.Effect<void>
  readonly invalidateByModel: (model: string) => Effect.Effect<void>
  readonly count: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSearch/EmbeddingCache") {}

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const config = yield* Config.Service

    const get = Effect.fn("EmbeddingCache.get")(function* (fingerprint: string, model: string) {
      const row = yield* db
        .select({
          vector: SessionSearchEmbeddingTable.vector,
          model: SessionSearchEmbeddingTable.model,
        })
        .from(SessionSearchEmbeddingTable)
        .where(eq(SessionSearchEmbeddingTable.fingerprint, fingerprint))
        .get()
        .pipe(Effect.orDie)

      if (!row) return Option.none()
      if (row.model !== model) return Option.none()

      yield* db
        .update(SessionSearchEmbeddingTable)
        .set({ last_accessed_at: Date.now() })
        .where(eq(SessionSearchEmbeddingTable.fingerprint, fingerprint))
        .run()
        .pipe(Effect.orDie)

      return Option.some(new Float32Array(row.vector))
    })

    const set = (fingerprint: string, vector: number[], dimensions: number, model: string) =>
      Effect.gen(function* () {
        const buffer = Buffer.from(new Float32Array(vector).buffer)
        const now = Date.now()

        yield* db.run(sql`
            INSERT INTO session_search_embedding (fingerprint, vector, dimensions, model, created_at, last_accessed_at)
            VALUES (${fingerprint}, ${buffer}, ${dimensions}, ${model}, ${now}, ${now})
            ON CONFLICT(fingerprint) DO UPDATE SET vector = excluded.vector, dimensions = excluded.dimensions, model = excluded.model, last_accessed_at = excluded.last_accessed_at
          `).pipe(Effect.orDie)

        yield* evictIfNeeded()
      })

    const invalidateByModel = Effect.fn("EmbeddingCache.invalidateByModel")(function* (model: string) {
      yield* db
        .delete(SessionSearchEmbeddingTable)
        .where(eq(SessionSearchEmbeddingTable.model, model))
        .run()
        .pipe(Effect.orDie)
    })

    const count = Effect.fn("EmbeddingCache.count")(function* () {
      const rows = yield* db
        .select({ cnt: sql<number>`count(*)` })
        .from(SessionSearchEmbeddingTable)
        .all()
        .pipe(Effect.orDie)
      return rows[0]?.cnt ?? 0
    })

    function evictIfNeeded() {
      return Effect.gen(function* () {
        const cfg = yield* config.get()
        const maxEntries = cfg.session_search?.embedding_cache_max_entries ?? DEFAULT_MAX_ENTRIES
        const current = yield* count()
        if (current <= maxEntries) return
        const toRemove = current - maxEntries
        yield* db.run(sql`
          DELETE FROM session_search_embedding WHERE fingerprint IN (
            SELECT fingerprint FROM session_search_embedding
            ORDER BY last_accessed_at ASC
            LIMIT ${toRemove}
          )
        `).pipe(Effect.orDie)
      })
    }

    return Service.of({ get, set, invalidateByModel, count })
  }),
)
