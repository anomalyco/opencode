import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { eq, desc } from "drizzle-orm"
import { Database } from "@/storage/db"
import { MemoryTable } from "./memory.sql"
import { EmbeddingService, cosineSimilarity, OLLAMA_BASE } from "@opencode-ai/database/embedding/service"

export class MemoryError extends Schema.TaggedErrorClass<MemoryError>()("MemoryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface MemoryEntry {
  id: string
  content: string
  metadata: Record<string, unknown> | null
  time_created: number
}

export interface SearchResult extends MemoryEntry {
  score: number
}

export interface Interface {
  add(input: {
    content: string
    metadata?: Record<string, unknown>
  }): Effect.Effect<{ id: string }, MemoryError>

  search(query: string, opts?: {
    limit?: number
  }): Effect.Effect<SearchResult[], MemoryError>

  list(): Effect.Effect<MemoryEntry[], MemoryError>

  get(id: string): Effect.Effect<Option.Option<MemoryEntry>, MemoryError>

  forget(id: string): Effect.Effect<void, MemoryError>

  recall(query: string, opts?: {
    limit?: number
  }): Effect.Effect<string[], MemoryError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const OLLAMA_TIMEOUT = 10000

const ollamaPing = Effect.tryPromise({
  try: async () => {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return true as const
  },
  catch: () => false as const,
}).pipe(Effect.option)

let ollamaReady = false

const ensureOllama = Effect.gen(function* () {
  if (ollamaReady) return

  const okOpt = yield* ollamaPing
  if (Option.isSome(okOpt) && okOpt.value) {
    ollamaReady = true
    return
  }

  yield* Effect.sync(() => {
    Bun.spawn(["ollama", "serve"], {
      stdio: ["ignore", "ignore", "ignore"],
    }).unref()
  })

  for (let i = 0; i < 30; i++) {
    const readyOpt = yield* ollamaPing
    if (Option.isSome(readyOpt) && readyOpt.value) {
      ollamaReady = true
      return
    }
    yield* Effect.sleep("1 seconds")
  }

  yield* Effect.die(new MemoryError({ message: "Ollama failed to start after 30 seconds" }))
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const embeddings = yield* EmbeddingService

    const add: Interface["add"] = Effect.fn("Memory.add")(function* (input) {
      yield* ensureOllama

      const id = crypto.randomUUID()

      const embedded = yield* embeddings.embed(input.content).pipe(
        Effect.timeout(OLLAMA_TIMEOUT),
        Effect.mapError((e) => new MemoryError({ message: "Failed to generate embedding", cause: e })),
      )

      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.insert(MemoryTable).values({
            id,
            content: input.content,
            metadata: (input.metadata as Record<string, unknown>) ?? null,
            embedding: JSON.stringify(embedded),
          }).run()
        }),
      )

      return { id }
    })

    const search: Interface["search"] = Effect.fn("Memory.search")(function* (query, opts) {
      yield* ensureOllama

      const limit = opts?.limit ?? 10

      const queryVec = yield* embeddings.embed(query).pipe(
        Effect.timeout(OLLAMA_TIMEOUT),
        Effect.mapError((e) => new MemoryError({ message: "Failed to generate query embedding", cause: e })),
      )

      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(MemoryTable).all(),
        ),
      )

      const scored = rows
        .filter((row) => row.embedding !== null)
        .map((row) => ({
          id: row.id,
          content: row.content,
          metadata: row.metadata,
          time_created: row.time_created,
          score: cosineSimilarity(queryVec, JSON.parse(row.embedding!) as number[]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      return scored
    })

    const list: Interface["list"] = Effect.fn("Memory.list")(function* () {
      return yield* Effect.sync(() =>
        Database.use((db) =>
          db.select({
            id: MemoryTable.id,
            content: MemoryTable.content,
            metadata: MemoryTable.metadata,
            time_created: MemoryTable.time_created,
          })
            .from(MemoryTable)
            .orderBy(desc(MemoryTable.time_created))
            .all(),
        ),
      )
    })

    const get: Interface["get"] = Effect.fn("Memory.get")(function* (id) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select({
            id: MemoryTable.id,
            content: MemoryTable.content,
            metadata: MemoryTable.metadata,
            time_created: MemoryTable.time_created,
          })
            .from(MemoryTable)
            .where(eq(MemoryTable.id, id))
            .all(),
        ),
      )
      return Option.fromNullishOr(rows[0])
    })

    const forget: Interface["forget"] = Effect.fn("Memory.forget")(function* (id) {
      yield* Effect.sync(() =>
        Database.transaction((db) => {
          db.delete(MemoryTable).where(eq(MemoryTable.id, id)).run()
        }),
      )
    })

    const recall: Interface["recall"] = Effect.fn("Memory.recall")(function* (query, opts) {
      const results = yield* search(query, opts)
      if (results.length === 0) return []

      const lines = results.map(
        (r) => `- [${r.score.toFixed(2)}] ${r.content}`,
      )

      return ["<memories>", ...lines, "</memories>"]
    })

    return Service.of({ add, search, list, get, forget, recall })
  }),
).pipe(Layer.provide(EmbeddingService.layer))

export const defaultLayer = layer

export * as Memory from "./memory"
