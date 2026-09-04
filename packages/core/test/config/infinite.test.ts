import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigInfinite } from "@opencode-ai/schema/config/infinite"
import { SessionInfinite } from "@opencode-ai/core/session/infinite"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const decode = Schema.decodeUnknownSync(Info)

describe("Infinite config", () => {
  it.effect("resolves defaults when no infinite config is present", () =>
    Effect.sync(() => {
      const resolved = SessionInfinite.resolve([])
      expect(resolved).toEqual({
        maxIterations: 100,
        maxHours: 8,
        sentinel: "[TASK_COMPLETE]",
        todoDetection: true,
      })
    }),
  )

  it.effect("merges partial configs with later documents winning", () =>
    Effect.sync(() => {
      const resolved = SessionInfinite.resolve([
        new ConfigInfinite.Info({ maxIterations: 5 }),
        new ConfigInfinite.Info({ sentinel: "DONE", maxHours: 2 }),
        new ConfigInfinite.Info({ todoDetection: false }),
      ])
      expect(resolved).toEqual({
        maxIterations: 5,
        maxHours: 2,
        sentinel: "DONE",
        todoDetection: false,
      })
    }),
  )

  it.effect("decodes infinite config from raw JSON and registers as optional", () =>
    Effect.sync(() => {
      const empty = decode({})
      expect(empty.infinite).toBeUndefined()
      const configured = decode({ infinite: { maxIterations: 10, sentinel: "[DONE]" } })
      expect(configured.infinite).toBeInstanceOf(ConfigInfinite.Info)
      expect(configured.infinite?.maxIterations).toBe(10)
      expect(configured.infinite?.sentinel).toBe("[DONE]")
      expect(configured.infinite?.maxHours).toBeUndefined()
      expect(SessionInfinite.resolve(configured.infinite ? [configured.infinite] : []).maxHours).toBe(8)
      const latest = Config.latest(
        [
          new Document({ type: "document", info: decode({ infinite: { maxIterations: 3 } }) }),
          new Document({ type: "document", info: decode({ infinite: { maxIterations: 7 } }) }),
        ],
        "infinite",
      )
      expect(latest?.maxIterations).toBe(7)
    }),
  )
})
