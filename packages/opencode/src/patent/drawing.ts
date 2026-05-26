import { Context, Effect, Layer, Schema } from "effect"
import { generateText } from "ai"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { ProviderID } from "@/provider/schema"

export interface Interface {
  readonly analyzeDrawing: (
    image: Buffer | string,
    context?: string,
  ) => Effect.Effect<{ description: string; elements: string[] }>
  readonly extractDrawingElements: (image: Buffer | string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentDrawing") {}

export const layer: Layer.Layer<
  Service,
  never,
  Config.Service | Provider.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const config = yield* Config.Service

    const findVisionModel = Effect.fn("PatentDrawing.findVisionModel")(() =>
      Effect.gen(function* () {
        const providers = yield* provider.list()
        for (const [pid, pInfo] of Object.entries(providers)) {
          for (const model of Object.values(pInfo.models)) {
            if (model.capabilities.input.image) {
              return { providerID: pid as ProviderID, modelID: model.id }
            }
          }
        }
        return null
      }),
    )

    const analyzeDrawing = Effect.fn("PatentDrawing.analyzeDrawing")(
      function* (image: Buffer | string, context?: string) {
        const visionModel = yield* findVisionModel()
        if (!visionModel) {
          return {
            description: "[无可用的多模态模型，请配置支持 vision 的模型]",
            elements: ["[待分析]"],
          }
        }

        const model = yield* provider.getModel(visionModel.providerID, visionModel.modelID)
        const language = yield* provider.getLanguage(model)

        const base64 = typeof image === "string" ? image : Buffer.from(image).toString("base64")

        const prompt = context
          ? `请分析以下专利技术图纸。上下文：${context}\n\n请提供：1) 图纸的整体描述 2) 识别出的组件、标注和连接关系`
          : `请分析以下专利技术图纸。请提供：1) 图纸的整体描述 2) 识别出的组件、标注和连接关系`

        const text = yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: language,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image", image: base64 },
                  ],
                },
              ],
            }).then((r) => r.text),
          catch: (cause) => {
            const msg = cause instanceof Error ? cause.message : String(cause)
            throw new Error(`图纸分析失败: ${msg}`)
          },
        })

        const elements = text
          .split("\n")
          .filter((line: string) => line.match(/^[-•*\d.]/))
          .map((line: string) => line.replace(/^[-•*\d.]\s*/, "").trim())
          .filter(Boolean)

        return {
          description: text,
          elements: elements.length > 0 ? elements : ["[未能提取要素]"],
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

export const defaultLayer = layer.pipe(Layer.provide(Provider.defaultLayer)).pipe(Layer.provide(Config.defaultLayer))

export * as PatentDrawing from "./drawing"