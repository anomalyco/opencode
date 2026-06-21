import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as MemoryService, layer as MemoryLayer } from "../src/memory/service"
import { Database } from "../src/database/database"
import { it } from "./lib/effect"

function layer() {
  return MemoryLayer.pipe(
    Layer.provide(Database.layerFromPath(":memory:").pipe(Layer.fresh)),
  )
}

describe("MemoryService", () => {
  it.live("stores and recalls memories using cosine similarity", () =>
    Effect.gen(function* () {
      const memory = yield* MemoryService
      
      // Store facts
      const entry1 = yield* memory.remember("Carlos prefere programar em Python para scripts rápidos.")
      expect(entry1.content).toBe("Carlos prefere programar em Python para scripts rápidos.")
      
      const entry2 = yield* memory.remember("O assistente pessoal se chama ZERO.")
      expect(entry2.content).toBe("O assistente pessoal se chama ZERO.")
      
      // Recall facts
      const results1 = yield* memory.recall("Carlos")
      expect(results1.length).toBeGreaterThan(0)
      expect(results1[0].content).toContain("Carlos prefere programar")
      
      const results2 = yield* memory.recall("Qual o nome do assistente?")
      expect(results2.length).toBeGreaterThan(0)
      expect(results2[0].content).toContain("ZERO")
    }).pipe(Effect.provide(layer())),
  )
})
