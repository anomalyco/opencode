import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PatentIPC } from "@/patent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"

const layer = PatentIPC.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const it = testEffect(layer)

describe("PatentIPC", () => {
  it.instance("searchByDescription returns empty array when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentIPC.Service
      const result = yield* svc.searchByDescription("人工智能")
      expect(result).toEqual([])
    }),
  )

  it.instance("getByCode returns null when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentIPC.Service
      const result = yield* svc.getByCode("G06N")
      expect(result).toBeNull()
    }),
  )

  it.instance("getStatistics returns null when database not found", () =>
    Effect.gen(function* () {
      const svc = yield* PatentIPC.Service
      const result = yield* svc.getStatistics("G06N")
      expect(result).toBeNull()
    }),
  )
})
