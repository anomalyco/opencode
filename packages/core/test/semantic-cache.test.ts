import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../src/database/database"
import { SemanticCacheTable } from "../src/memory/sql"
import { getEmbedding, cosineSimilarity } from "../src/memory/service"
import { it } from "./lib/effect"

function layer() {
  return Database.layerFromPath(":memory:").pipe(Layer.fresh)
}

describe("Semantic Cache", () => {
  it.live("stores, calculates similarity and hits/misses semantic cache in SQLite", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      
      const prompt1 = "Como posso criar uma API Rest em Node.js usando Express?"
      const prompt2 = "como posso criar uma api rest em node.js usando express"
      const promptDifferent = "Qual a capital da França?"

      // Calcula os embeddings dos prompts
      const embedding1 = yield* Effect.promise(() => getEmbedding(prompt1))
      const embedding2 = yield* Effect.promise(() => getEmbedding(prompt2))
      const embeddingDifferent = yield* Effect.promise(() => getEmbedding(promptDifferent))

      // Salva no banco de dados SQLite em memória
      const id = "sem_test_1"
      const now = Date.now()
      const cachedResponse = JSON.stringify([{ type: "text", text: "Aqui está o exemplo de código para Express..." }])

      yield* db.insert(SemanticCacheTable).values({
        id,
        prompt: prompt1,
        prompt_embedding: JSON.stringify(embedding1),
        response: cachedResponse,
        time_created: now,
        time_updated: now,
      }).pipe(Effect.orDie)

      // Recupera todos os caches e faz o match
      const cacheRows = yield* db.select().from(SemanticCacheTable).all().pipe(Effect.orDie)
      expect(cacheRows.length).toBe(1)

      // Teste de Hit (com prompt2 que é muito similar ao prompt1)
      let bestScore = 0
      let hitResponse: string | null = null

      for (const row of cacheRows) {
        const rowEmbedding = JSON.parse(row.prompt_embedding) as number[]
        const score = cosineSimilarity(embedding2, rowEmbedding)
        if (score > bestScore) {
          bestScore = score
          if (score >= 0.95) {
            hitResponse = row.response
          }
        }
      }

      expect(bestScore).toBeGreaterThanOrEqual(0.95)
      expect(hitResponse).not.toBeNull()
      expect(JSON.parse(hitResponse!)[0].text).toContain("Express")

      // Teste de Miss (com promptDifferent que é completely diferente)
      let missScore = 0
      let missResponse: string | null = null

      for (const row of cacheRows) {
        const rowEmbedding = JSON.parse(row.prompt_embedding) as number[]
        const score = cosineSimilarity(embeddingDifferent, rowEmbedding)
        if (score > missScore) {
          missScore = score
          if (score >= 0.95) {
            missResponse = row.response
          }
        }
      }

      expect(missScore).toBeLessThan(0.95)
      expect(missResponse).toBeNull()
    }).pipe(Effect.provide(layer())),
  )
})
