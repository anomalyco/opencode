import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Media } from "../../src/effect.js"
import { Google } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

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
      const response = yield* ai.image.generate({
        model,
        prompt: "A simple flat blue circle centered on a plain white background.",
        aspect: "1:1",
      })

      expect(response.images).toHaveLength(1)
      expect(response.images[0].mediaType).toMatch(/^image\//)
      expect((yield* response.images[0].bytes()).length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("edits an image", () =>
    Effect.gen(function* () {
      const response = yield* ai.image.generate({
        model,
        prompt:
          "Transform this minimal source into a bright orange sun icon with eight rounded rays on a pale blue background.",
        images: [
          Media.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        aspect: "1:1",
      })

      expect(response.images[0].mediaType).toBe("image/jpeg")
      expect(dimensions(yield* response.images[0].bytes())).toEqual({ width: 1024, height: 1024 })
    }),
  )
})
