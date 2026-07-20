import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, ImageInput } from "../../src"
import { Google } from "../../src/providers"
import { dimensions } from "../lib/image"
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

  recorded.effect("edits an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt:
          "Transform this minimal source into a bright orange sun icon with eight rounded rays on a pale blue background.",
        images: [
          ImageInput.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        options: { aspectRatio: "1:1" },
      })

      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      if (!(response.image?.data instanceof Uint8Array)) throw new Error("Expected owned Google image bytes")
      expect(dimensions(response.image.data)).toEqual({ width: 1024, height: 1024 })
    }),
  )
})
