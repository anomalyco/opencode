import { Context, Effect, Layer } from "effect"

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
        return {
          description: "[Placeholder: Vision model integration needs Provider Service]",
          elements: ["[Placeholder elements]"],
        }
      },
    )

    const extractDrawingElements = Effect.fn("PatentDrawing.extractDrawingElements")(
      function* (image: Buffer | string) {
        return ["[Placeholder elements]"]
      },
    )

    return Service.of({ analyzeDrawing, extractDrawingElements })
  }),
)

export const defaultLayer = layer

export * as PatentDrawing from "./drawing"