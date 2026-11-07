import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, Media } from "../../src/effect.js"
import { OpenRouter } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const openrouter = OpenRouter.configure({ apiKey: process.env.OPENROUTER_API_KEY ?? "fixture" })

const recorded = recordedTests({
  prefix: "openrouter-images",
  provider: "openrouter",
  protocol: "openai-images",
  requires: ["OPENROUTER_API_KEY"],
})

// Replay matches the recorded request body, so these also pin `aspect_ratio` and `resolution` going out instead of a
// pixel `size`.
describe("OpenRouter Images recorded", () => {
  recorded.effect(
    "renders Gemini at the requested 2K tier",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model: openrouter.image("google/gemini-3.1-flash-image"),
          prompt: "A simple flat black circle centered on a plain white background.",
          aspect: "16:9",
          resolution: "2K",
        })

        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 2752, height: 1536 })
      }),
    { timeout: 120_000 },
  )

  recorded.effect(
    "renders FLUX 3 from an aspect ratio and tier",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model: openrouter.image("black-forest-labs/flux-3-image-klein"),
          prompt: "A simple flat black circle centered on a plain white background.",
          aspect: "16:9",
          resolution: "1K",
        })

        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1360, height: 768 })
      }),
    { timeout: 120_000 },
  )

  // OpenRouter has no `/images/edits`; the image has to go out as an `input_references` data URL on the JSON body.
  recorded.effect(
    "edits an image through input references",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model: openrouter.image("openai/gpt-image-1-mini"),
          prompt: "Keep the simple shape and change it from black to bright green.",
          images: [
            Media.bytes(
              yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
              "image/jpeg",
            ),
          ],
          aspect: "1:1",
          resolution: "1K",
          providerOptions: { outputFormat: "jpeg", quality: "low", outputCompression: 10 },
        })

        expect(response.image.mediaType).toBe("image/jpeg")
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1024, height: 1024 })
      }),
    { timeout: 120_000 },
  )
})
