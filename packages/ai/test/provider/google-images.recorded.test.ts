import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src"
import { Google } from "../../src/providers"
import { recordedTests } from "../recorded-test"

const model = Google.configure({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
}).image("gemini-3.1-flash-image")

const recorded = recordedTests({
  prefix: "google-images",
  provider: "google",
  protocol: "google-images",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})

describe("Google Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat blue circle centered on a plain white background.",
        options: { aspectRatio: "1:1" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toMatch(/^image\//)
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      expect(response.image?.data.length).toBeGreaterThan(0)
    }),
  )
})
