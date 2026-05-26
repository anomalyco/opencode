import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PatentQuality } from "@/patent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"

const layer = PatentQuality.defaultLayer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

const testIt = testEffect(layer)

describe("PatentQuality", () => {
  testIt.instance("check returns 7 dimension scores", () =>
    Effect.gen(function* () {
      const svc = yield* PatentQuality.Service
      const result = yield* svc.check({
        document_type: "specification",
        content: "本发明涉及一种数据处理方法，包括以下步骤：获取数据、处理数据、输出结果。该方法提高处理效率。",
      })
      expect(result.scores).toHaveLength(7)
    }),
  )

  testIt.instance("check total score is weighted average", () =>
    Effect.gen(function* () {
      const svc = yield* PatentQuality.Service
      const result = yield* svc.check({
        document_type: "specification",
        content: "本发明涉及一种数据处理方法，包括以下步骤：获取数据、处理数据、输出结果。该方法提高处理效率90%。",
      })

      const weightedSum = result.scores.reduce((sum: number, s) => sum + s.score * s.weight, 0)
      const totalWeight = result.scores.reduce((sum: number, s) => sum + s.weight, 0)
      const expected = Number((weightedSum / totalWeight).toFixed(2))

      expect(result.totalScore).toBe(expected)
    }),
  )

  testIt.instance("check passed is determined by threshold", () =>
    Effect.gen(function* () {
      const svc = yield* PatentQuality.Service

      const highQualityResult = yield* svc.check({
        document_type: "specification",
        content: `本发明涉及一种高效数据处理系统，包括以下技术方案：

技术领域：本发明属于计算机技术领域，特别涉及数据处理系统。

背景技术：现有技术存在处理效率低的问题。

发明内容：本发明提供一种数据处理系统，包括：
1. 数据采集模块，用于采集原始数据；
2. 数据处理模块，采用深度学习算法处理数据，处理效率提升90%；
3. 数据输出模块，用于输出处理结果。

本发明采用优选实施例，技术方案清晰明确。

权利要求书：
1. 一种数据处理系统，其特征在于，包括数据采集模块、数据处理模块和数据处理模块。

实施例：
具体实施方式如图1所示，系统包括三个模块（1）、（2）、（3）。`,
      })

      const lowQualityResult = yield* svc.check({
        document_type: "specification",
        content: "短",
      })

      expect(highQualityResult.passed).toBe(true)
      expect(lowQualityResult.passed).toBe(false)
    }),
  )

  testIt.instance("autoFix returns content", () =>
    Effect.gen(function* () {
      const svc = yield* PatentQuality.Service
      const input = {
        document_type: "specification" as const,
        content: "短内容",
      }
      const report = yield* svc.check(input)
      const fixed = yield* svc.autoFix(input, report)

      expect(fixed).toContain("短内容")
    }),
  )

  testIt.instance("autoFix includes suggestions when report not passed", () =>
    Effect.gen(function* () {
      const svc = yield* PatentQuality.Service
      const input = {
        document_type: "specification" as const,
        content: "短",
      }
      const report = yield* svc.check(input)

      if (!report.passed) {
        const fixed = yield* svc.autoFix(input, report)
        expect(fixed).toContain("自动修复建议")
      }
    }),
  )
})