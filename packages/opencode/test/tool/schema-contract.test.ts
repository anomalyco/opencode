import { afterEach, describe, expect } from "bun:test"
import z from "zod"
import { Effect, Layer } from "effect"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { ToolRegistry } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))
const targetToolIDs = ["inspect", "search", "lsp", "edit"] as const

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool schema contracts", () => {
  it.live("exposes object-root public schemas for canonical multi-action tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tools = yield* registry.all()
        const targets = tools.filter((tool) => targetToolIDs.includes(tool.id as (typeof targetToolIDs)[number]))
        expect(targets.map((tool) => tool.id).toSorted()).toEqual([...targetToolIDs].toSorted())
        for (const target of targets) {
          const schema = z.toJSONSchema(target.parameters)
          expect(schema.type).toBe("object")
        }
      }),
    ),
  )
})
