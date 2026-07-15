import { Image } from "@opencode-ai/core/image"
import { Effect, Layer } from "effect"

/** Passthrough resizer for tests that build ToolRegistry.node without a Location. */
export const imagePassthrough = Layer.mock(Image.Service, {
  normalize: (_resource, content) => Effect.succeed(content),
})
