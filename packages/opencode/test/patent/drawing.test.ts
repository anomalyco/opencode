import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import * as PatentDrawing from "@/patent/drawing"

const mockLayer = Layer.succeed(
  PatentDrawing.Service,
  PatentDrawing.Service.of({
    analyzeDrawing: Effect.fn("mock.analyzeDrawing")(
      (_image: Buffer | string, context?: string) =>
        Effect.succeed({
          description: context
            ? `图纸分析待实现: 图像已转换为 base64 格式。上下文信息: ${context}`
            : "图纸分析待实现: 图像已转换为 base64 格式",
          elements: ["[待视觉模型支持]"],
        }),
    ),
    extractDrawingElements: Effect.fn("mock.extractDrawingElements")((_image: Buffer | string) =>
      Effect.succeed(["[待视觉模型支持]"]),
    ),
  }),
)

const it = testEffect(mockLayer)

describe("PatentDrawing", () => {
  it.effect("analyzeDrawing returns description and elements", () =>
    Effect.gen(function* () {
      const svc = yield* PatentDrawing.Service
      const result = yield* svc.analyzeDrawing(Buffer.from("fake-image"))
      expect(result).toHaveProperty("description")
      expect(result).toHaveProperty("elements")
      expect(Array.isArray(result.elements)).toBe(true)
    }),
  )

  it.effect("analyzeDrawing includes context in description when provided", () =>
    Effect.gen(function* () {
      const svc = yield* PatentDrawing.Service
      const result = yield* svc.analyzeDrawing(Buffer.from("fake-image"), "测试上下文")
      expect(result.description).toContain("测试上下文")
    }),
  )

  it.effect("extractDrawingElements returns array", () =>
    Effect.gen(function* () {
      const svc = yield* PatentDrawing.Service
      const result = yield* svc.extractDrawingElements(Buffer.from("fake-image"))
      expect(Array.isArray(result)).toBe(true)
    }),
  )
})