import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Command } from "../../src/command"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LayerNode.compile(Command.node), LayerNode.compile(CrossSpawnSpawner.node)))

const template = (command: Command.Info | undefined) => Effect.promise(async () => command?.template)

describe("command", () => {
  it.live("config without template partially overrides the built-in review command", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const commands = yield* Command.Service
          const review = yield* commands.get("review")
          expect(review?.agent).toBe("reviewer")
          expect(review?.subtask).toBe(true)
          expect(yield* template(review)).toContain("You are a code reviewer.")
        }),
      { config: { command: { review: { agent: "reviewer" } } } },
    ),
  )

  it.live("config with template still fully overrides the built-in review command", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const commands = yield* Command.Service
          const review = yield* commands.get("review")
          expect(review?.agent).toBe("reviewer")
          expect(review?.subtask).toBeUndefined()
          expect(review?.description).toBeUndefined()
          expect(yield* template(review)).toBe("Custom review")
        }),
      { config: { command: { review: { template: "Custom review", agent: "reviewer" } } } },
    ),
  )

  it.live("config command without template and without a built-in counterpart is skipped", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const commands = yield* Command.Service
          expect(yield* commands.get("ghost")).toBeUndefined()
        }),
      { config: { command: { ghost: { agent: "reviewer" } } } },
    ),
  )
})
