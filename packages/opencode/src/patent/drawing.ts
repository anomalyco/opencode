import { Context, Effect, Layer, Schema } from "effect"

const DrawingAnalysisSchema = Schema.Struct({
  description: Schema.String,
  elements: Schema.Array(Schema.String),
})

export interface Interface {
  readonly analyzeDrawing: (
    image: Buffer | string,
    context?: string,
  ) => Effect.Effect<{ description: string; elements: string[] }>
  readonly extractDrawingElements: (image: Buffer | string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentDrawing") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const analyzeDrawing = Effect.fn("PatentDrawing.analyzeDrawing")(
      function* (image: Buffer | string, context?: string) {
        const imageBase64 = typeof image === "string"
          ? image
          : Buffer.from(image).toString("base64")

        return {
          description: context
            ? `图纸分析待实现: 图像已转换为 base64 格式。上下文信息: ${context}`
            : "图纸分析待实现: 图像已转换为 base64 格式",
          elements: ["[待视觉模型支持]"],
        }
      },
    )

    const extractDrawingElements = Effect.fn("PatentDrawing.extractDrawingElements")(
      function* (image: Buffer | string) {
        const analysis = yield* analyzeDrawing(image)
        return analysis.elements
      },
    )

    return Service.of({ analyzeDrawing, extractDrawingElements })
  }),
)

export const defaultLayer = layer
export * as PatentDrawing from "./drawing"