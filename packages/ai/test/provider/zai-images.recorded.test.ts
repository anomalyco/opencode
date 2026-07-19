import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src"
import { ZAI } from "../../src/providers"
import { recordedTests } from "../recorded-test"

const model = ZAI.configure({
  apiKey: process.env.ZAI_API_KEY ?? "fixture",
  image: { providerOptions: { quality: "standard", userID: "opencode-image-test" } },
}).image("cogview-4-250304")

const recorded = recordedTests({
  prefix: "zai-images",
  provider: "zai",
  protocol: "zai-images",
  requires: ["ZAI_API_KEY"],
})

describe("Z.ai Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat red circle centered on a plain white background.",
        size: { width: 1024, height: 1024 },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toBeString()
      expect(response.image?.data).toStartWith("https://")
      expect(response.providerMetadata?.zai).toBeDefined()
    }),
  )
})
