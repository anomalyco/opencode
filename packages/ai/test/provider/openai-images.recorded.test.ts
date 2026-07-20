import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, ImageInput } from "../../src"
import { OpenAI } from "../../src/providers"
import { dimensions } from "../lib/image"
import { recordedTests } from "../recorded-test"

const model = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
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
        options: { quality: "low", outputFormat: "jpeg", outputCompression: 10, size: "1024x1024" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType).toBe("image/jpeg")
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      expect(response.image?.data.length).toBeGreaterThan(0)
    }),
  )

  recorded.effect.with(
    "edits an image",
    {
      options: {
        match: (incoming, recorded) => incoming.method === recorded.method && incoming.url === recorded.url,
      },
    },
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate({
          model,
          prompt: "Keep the simple shape and change it from black to bright green.",
          images: [
            ImageInput.bytes(
              yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
              "image/jpeg",
            ),
          ],
          options: { quality: "low", outputFormat: "jpeg", outputCompression: 10, size: "1024x1024" },
        })

        expect(response.image?.mediaType).toBe("image/jpeg")
        expect(response.image?.data).toBeInstanceOf(Uint8Array)
        if (!(response.image?.data instanceof Uint8Array)) throw new Error("Expected owned OpenAI image bytes")
        expect(dimensions(response.image.data)).toEqual({ width: 1024, height: 1024 })
      }),
  )
})
