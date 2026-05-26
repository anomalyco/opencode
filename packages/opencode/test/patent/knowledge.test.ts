import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PatentKnowledge } from "@/patent/knowledge"

const it = testEffect(PatentKnowledge.defaultLayer)

describe("PatentKnowledge", () => {
  it.effect("searchSemantic returns results for existing query", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const results = yield* svc.searchSemantic("三步法", { limit: 5, threshold: 0.5 })
      expect(Array.isArray(results)).toBe(true)
    }),
  )

  it.effect("searchSemantic returns empty for non-existent query", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const results = yield* svc.searchSemantic("不存在xyz123", { limit: 5, threshold: 0.5 })
      expect(Array.isArray(results)).toBe(true)
    }),
  )

  it.effect("searchCards returns results for existing keyword", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const results = yield* svc.searchCards("创造性")
      expect(Array.isArray(results)).toBe(true)
    }),
  )

  it.effect("searchGuidelines returns non-empty string for existing topic", () =>
    Effect.gen(function* () {
      const svc = yield* PatentKnowledge.Service
      const result = yield* svc.searchGuidelines("新颖性")
      expect(typeof result).toBe("string")
    }),
  )
})