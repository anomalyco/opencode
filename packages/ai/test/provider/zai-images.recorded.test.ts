import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/index.js"
import { ZAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const model = ZAI.configure({ apiKey: process.env.ZAI_API_KEY ?? "fixture" }).image("cogview-4-250304")

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
        options: { size: "1024x1024", quality: "standard", userID: "opencode-image-test" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("application/octet-stream")
      expect(response.image?.data).toBeString()
      expect(response.image?.data).toStartWith("https://")
      expect(response.providerMetadata?.zai).toBeDefined()
    }),
  )
})
