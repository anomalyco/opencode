import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalKnowledgeTable } from "./sql"
import { eq, desc, and, like } from "drizzle-orm"
import { Identifier } from "../util/identifier"
import { parseEmbeddingJson } from "../memory/embedding"

export { getEmbedding, cosineSimilarity } from "../memory/embedding"

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  source: string | null
  tags: string[]
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly index: (title: string, content: string, source?: string, tags?: string[]) => Effect.Effect<KnowledgeEntry>
  readonly search: (query: string, limit?: number) => Effect.Effect<KnowledgeEntry[]>
  readonly list: (tag?: string) => Effect.Effect<KnowledgeEntry[]>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly get: (id: string) => Effect.Effect<KnowledgeEntry | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Knowledge") {}

function parseKnowledgeRow(row: any): KnowledgeEntry {
  let tags: string[] = []
  try {
    tags = row.tags ? JSON.parse(row.tags) : []
  } catch {}
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    tags,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  return Service.of({
    index: (title, content, source, tags) =>
      Effect.gen(function* () {
        const { getEmbedding } = yield* Effect.promise(() => import("../memory/embedding"))
        const id = "knw_" + Identifier.ascending()
        const embedding = yield* Effect.promise(() => getEmbedding(title + " " + content))
        const now = Date.now()
        const row = {
          id,
          title,
          content,
          source: source ?? null,
          tags: tags ? JSON.stringify(tags) : null,
          embedding: JSON.stringify(embedding),
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalKnowledgeTable).values(row).pipe(Effect.orDie)
        return { id, title, content, source: source ?? null, tags: tags ?? [], time_created: now, time_updated: now }
      }),
    search: (query, limit) =>
      Effect.gen(function* () {
        const { getEmbedding, cosineSimilarity } = yield* Effect.promise(() => import("../memory/embedding"))
        const n = limit ?? 5
        const queryEmbedding = yield* Effect.promise(() => getEmbedding(query))
        const rows = yield* db.select().from(PersonalKnowledgeTable).all().pipe(Effect.orDie)
        const scored = rows.map((row) => {
          const embedding = parseEmbeddingJson(row.embedding)
          const score = embedding.length > 0 ? cosineSimilarity(queryEmbedding, embedding) : 0
          return { score, entry: parseKnowledgeRow(row) }
        })
        return scored
          .filter((s) => s.score > 0.1)
          .sort((a, b) => b.score - a.score)
          .slice(0, n)
          .map((s) => s.entry)
      }),
    list: (tag) =>
      Effect.gen(function* () {
        const conditions: any[] = []
        if (tag !== undefined)
          conditions.push(like(PersonalKnowledgeTable.tags, `%"${tag}"%`))
        const where = conditions.length > 0 ? and(...conditions) : undefined
        const query = db
          .select()
          .from(PersonalKnowledgeTable)
          .orderBy(desc(PersonalKnowledgeTable.time_created))
        const rows = yield* (where ? query.where(where) : query).all().pipe(Effect.orDie)
        return rows.map(parseKnowledgeRow)
      }),
    delete: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalKnowledgeTable)
          .where(eq(PersonalKnowledgeTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
    get: (id) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalKnowledgeTable)
          .where(eq(PersonalKnowledgeTable.id, id))
          .all()
          .pipe(Effect.orDie)
        return rows.length > 0 ? parseKnowledgeRow(rows[0]) : undefined
      }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as Knowledge }
