import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PatentLaw } from "@/patent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"

const layer = PatentLaw.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const it = testEffect(layer)

describe("PatentLaw", () => {
  it.live("searchLaw returns empty array when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentLaw.Service
      const result = yield* svc.searchLaw("专利")
      expect(result).toEqual([])
    }),
  )

  it.live("getByCategory returns empty array when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentLaw.Service
      const result = yield* svc.getByCategory("法律")
      expect(result).toEqual([])
    }),
  )

  it.live("getLawContent returns empty string when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentLaw.Service
      const result = yield* svc.getLawContent("test-id")
      expect(result).toEqual("")
    }),
  )
})