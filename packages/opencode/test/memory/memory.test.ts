import { describe, expect } from "bun:test"
import { Effect } from "effect"
import * as Memory from "@opencode-ai/core/memory/index"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { provideInstance } from "../fixture/fixture"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Memory.node
    ])
  )
)

describe("Memory.Service", () => {
  it("stores, lists, and deletes memories", (ctx) =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service

      const id1 = yield* memory.store("Remember the milk", "manual")
      const id2 = yield* memory.store("Remember the eggs", "auto")

      const list1 = yield* memory.list()
      expect(list1).toHaveLength(2)
      expect(list1.find((m) => m.id === id1)?.content).toBe("Remember the milk")

      const deleted = yield* memory.delete(id1)
      expect(deleted).toBe(true)

      const list2 = yield* memory.list()
      expect(list2).toHaveLength(1)
      expect(list2[0].id).toBe(id2)
    }).pipe(provideInstance(ctx))
  )

  it("pruneAuto enforces limits on auto-extracted memories", (ctx) =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service

      // Slight delay to ensure deterministic time_created ordering if necessary,
      // but SQLite timestamps might be precise enough if we just yield.
      yield* memory.store("Auto 1", "auto")
      yield* Effect.sleep(10)
      yield* memory.store("Auto 2", "auto")
      yield* Effect.sleep(10)
      yield* memory.store("Auto 3", "auto")
      yield* memory.store("Manual 1", "manual")

      // Keep only 2 auto memories
      yield* memory.pruneAuto(2)

      const list = yield* memory.list()
      
      const autos = list.filter(m => m.source === "auto")
      const manuals = list.filter(m => m.source === "manual")

      expect(autos).toHaveLength(2)
      expect(manuals).toHaveLength(1)
      
      // Auto 2 and 3 should be kept because they were created later
      expect(autos.some(m => m.content === "Auto 2")).toBe(true)
      expect(autos.some(m => m.content === "Auto 3")).toBe(true)
      expect(autos.some(m => m.content === "Auto 1")).toBe(false)
    }).pipe(provideInstance(ctx))
  )
})
