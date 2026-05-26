import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Trademark } from "@/patent/trademark"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { testEffect } from "../lib/effect"

const layer = Trademark.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const it = testEffect(layer)

describe("Trademark", () => {
  it.instance("search returns empty array when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* Trademark.Service
      const result = yield* svc.search({ markName: "测试商标" })
      expect(result).toEqual([])
    }),
  )

  it.instance("analyzeSimilarity returns correct result for identical marks", () =>
    Effect.gen(function* () {
      const svc = yield* Trademark.Service
      const result = yield* svc.analyzeSimilarity("测试", "测试")
      expect(result.similarityScore).toBe(1)
      expect(result.confusionRisk).toBe("高")
      expect(result.reasons).toContain("商标完全相同")
    }),
  )

  it.instance("analyzeSimilarity returns low score for different marks", () =>
    Effect.gen(function* () {
      const svc = yield* Trademark.Service
      const result = yield* svc.analyzeSimilarity("ABC", "XYZ")
      expect(result.confusionRisk).toBe("无")
    }),
  )

  it.instance("analyzeDistinctiveness returns correct result", () =>
    Effect.gen(function* () {
      const svc = yield* Trademark.Service
      const result = yield* svc.analyzeDistinctiveness("AI科技", "软件开发")
      expect(result.reasons.length).toBeGreaterThan(0)
      expect(result.distinctiveness).toBeDefined()
    }),
  )
})
