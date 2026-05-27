import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PatentKnowledge } from "@/patent/knowledge"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { Config } from "@/config/config"

const layer = PatentKnowledge.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const it = testEffect(layer)

describe("PatentKnowledge", () => {
  it.instance("searchSemantic returns empty for non-existent db", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const results = yield* svc.searchSemantic("三步法", { limit: 5, threshold: 0.5 })
      expect(Array.isArray(results)).toBe(true)
      expect(results).toEqual([])
    }),
  )

  it.instance("searchCards returns empty for non-existent dir", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const results = yield* svc.searchCards("创造性")
      expect(Array.isArray(results)).toBe(true)
    }),
  )

  it.instance("searchGuidelines returns empty string for non-existent dir", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const result = yield* svc.searchGuidelines("新颖性")
      expect(typeof result).toBe("string")
      expect(result).toEqual("")
    }),
  )

  it.instance("searchInvalidation returns empty string for non-existent dir", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const result = yield* svc.searchInvalidation("无效")
      expect(typeof result).toBe("string")
      expect(result).toEqual("")
    }),
  )
})
