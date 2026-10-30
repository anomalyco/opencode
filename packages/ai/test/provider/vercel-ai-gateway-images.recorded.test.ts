import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/effect.js"
import { VercelAIGateway } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const model = VercelAIGateway.configure({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? "fixture",
}).image("meta/muse-image-1.0")

const recorded = recordedTests({
  prefix: "vercel-ai-gateway-images",
  provider: "vercel-ai-gateway",
  protocol: "openai-images",
  requires: ["AI_GATEWAY_API_KEY"],
})

describe("Vercel AI Gateway Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat black circle centered on a plain white background.",
        providerOptions: { outputFormat: "webp" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image.mediaType).toBe("image/webp")
      expect(new TextDecoder().decode((yield* response.image.bytes()).subarray(8, 12))).toBe("WEBP")
      expect(model.provider).toBe("vercel-ai-gateway")
      expect(response.usage?.details).toHaveProperty("vercel-ai-gateway")
      expect(response.providerMetadata).toHaveProperty("vercel-ai-gateway")
    }),
  )

  // Grok ignores `size` behind the Gateway; replay matches the recorded `providerOptions.xai` body.
  recorded.effect(
    "sizes Grok through xAI provider options",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model: VercelAIGateway.configure({ apiKey: process.env.AI_GATEWAY_API_KEY ?? "fixture" }).image(
            "spacexai/grok-imagine-image",
          ),
          prompt: "A simple flat black circle centered on a plain white background.",
          aspect: "16:9",
          resolution: "1K",
        })

        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1280, height: 720 })
      }),
    { timeout: 120_000 },
  )
})
