import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src"
import { OpenAI } from "../../src/providers"
import { recordedTests } from "../recorded-test"

const model = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
  image: {
    providerOptions: {
      quality: "low",
      outputFormat: "jpeg",
      outputCompression: 10,
    },
  },
}).image("gpt-image-1-mini")

const recorded = recordedTests({
  prefix: "openai-images",
  provider: "openai",
  protocol: "openai-images",
  requires: ["OPENAI_API_KEY"],
})

describe("OpenAI Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat black circle centered on a plain white background.",
        size: { width: 1024, height: 1024 },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      expect(response.image?.data.length).toBeGreaterThan(0)
    }),
  )
})
