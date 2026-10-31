import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai } from "../../src/effect.js"
import { Nvidia } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const model = Nvidia.configure({ apiKey: process.env.NVIDIA_API_KEY ?? "fixture" }).image(
  "black-forest-labs/flux.2-klein-4b",
)

const recorded = recordedTests({
  prefix: "nvidia-images",
  provider: "nvidia",
  protocol: "nvidia-genai-images",
  requires: ["NVIDIA_API_KEY"],
})

describe("NVIDIA GenAI Images recorded", () => {
  recorded.effect("generates an image at the nearest listed size", () =>
    Effect.gen(function* () {
      const response = yield* ai.image.generate({
        model,
        prompt: "A red apple on a wooden table",
        aspect: "16:9",
        resolution: "0.5K",
        providerOptions: { seed: 3, steps: 1 },
      })

      expect(response.image.mediaType).toBe("image/jpeg")
      expect(response.image.providerMetadata).toEqual({ nvidia: { seed: 3 } })
      expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1024, height: 576 })
    }),
  )

  recorded.effect("surfaces a size the model rejects", () =>
    ai.image.generate({ model, prompt: "A red apple", providerOptions: { width: 64, height: 64, steps: 1 } }).pipe(
      Effect.flip,
      Effect.map((error) => expect(error.reason._tag).toBe("InvalidRequest")),
    ),
  )
})
