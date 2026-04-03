import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("tool.task", () => {
  it.live("description sorts subagents by name and is stable across calls", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          const build = yield* agent.get("build")
          const tool = yield* TaskTool
          const first = yield* Effect.promise(() => tool.init({ agent: build }))
          const second = yield* Effect.promise(() => tool.init({ agent: build }))

          expect(first.description).toBe(second.description)

          const alpha = first.description.indexOf("- alpha: Alpha agent")
          const explore = first.description.indexOf("- explore:")
          const general = first.description.indexOf("- general:")
          const zebra = first.description.indexOf("- zebra: Zebra agent")

          expect(alpha).toBeGreaterThan(-1)
          expect(explore).toBeGreaterThan(alpha)
          expect(general).toBeGreaterThan(explore)
          expect(zebra).toBeGreaterThan(general)
        }),
      {
        config: {
          agent: {
            zebra: {
              description: "Zebra agent",
              mode: "subagent",
            },
            alpha: {
              description: "Alpha agent",
              mode: "subagent",
            },
          },
        },
      },
    ),
  )
})
