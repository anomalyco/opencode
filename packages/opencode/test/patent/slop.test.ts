import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SlopDetector } from "@/patent/slop"
import { Config } from "@/config/config"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { testEffect } from "../lib/effect"

const layer = SlopDetector.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const it = testEffect(layer)

describe("SlopDetector", () => {
  it.instance("detect returns clean report for good content", () =>
    Effect.gen(function* () {
      const svc = yield* SlopDetector.Service
      const report = yield* svc.detect("权1相对D1的区别特征为特征(3)「缓存分片大小随负载动态调整」。D1第[0045]段仅公开固定4KB分片。")
      expect(report.passed).toBe(true)
      expect(report.score).toBeGreaterThan(5)
    }),
  )

  it.instance("detect catches slop phrases", () =>
    Effect.gen(function* () {
      const svc = yield* SlopDetector.Service
      const report = yield* svc.detect(
        "显而易见地，本领域技术人员能够实现该方案。综上所述，创造性得以确立。进一步地，不难发现，值得一提的，该方案具有显著的进步。赋能核心业务，扎实推进。",
      )
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.score).toBeLessThan(7)
    }),
  )

  it.instance("detect catches passive voice", () =>
    Effect.gen(function* () {
      const svc = yield* SlopDetector.Service
      const report = yield* svc.detect("权利要求被认为不具备创造性。申请被视为撤回。")
      expect(report.issues.some((i) => i.type === "pattern")).toBe(true)
    }),
  )

  it.instance("filter removes slop phrases", () =>
    Effect.gen(function* () {
      const svc = yield* SlopDetector.Service
      const { text, report } = yield* svc.filter("显而易见地，该方案具有显著的进步。进一步地，不难发现其创造性得以确立。")
      expect(text).not.toContain("显而易见地")
      expect(text).not.toContain("不难发现")
      expect(text).not.toContain("进一步地")
      expect(report.score).toBeGreaterThan(0)
    }),
  )
})
