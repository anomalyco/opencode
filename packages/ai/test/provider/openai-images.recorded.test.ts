import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Image, ImageEvent, Media } from "../../src/index.js"
import { OpenAI } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

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
        size: "1024x1024",
        format: "jpeg",
        providerOptions: { quality: "low", outputCompression: 10 },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image.mediaType).toBe("image/jpeg")
      expect(response.image.info).toEqual({ format: "jpeg", width: 1024, height: 1024 })
      expect((yield* response.image.bytes()).length).toBeGreaterThan(0)
      expect(response.providerMetadata).toEqual({
        openai: { outputFormat: "jpeg", size: "1024x1024", quality: "low", background: "opaque" },
      })
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
            Media.bytes(
              yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
              "image/jpeg",
            ),
          ],
          size: "1024x1024",
          format: "jpeg",
          providerOptions: { quality: "low", outputCompression: 10 },
        })

        expect(response.image.mediaType).toBe("image/jpeg")
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1024, height: 1024 })
      }),
  )

  recorded.effect("streams a partial image before the final image", () =>
    Effect.gen(function* () {
      const events = Array.from(
        yield* Image.stream({
          model,
          prompt: "A simple flat black circle centered on a plain white background.",
          size: "1024x1024",
          format: "jpeg",
          providerOptions: { quality: "low", outputCompression: 10, partialImages: 1 },
        }).pipe(Stream.runCollect),
      )

      expect(events.map((event) => event.type)).toEqual(["image-partial", "image", "finish"])
      const image = events.find(ImageEvent.is.image)
      expect(image?.image.mediaType).toBe("image/jpeg")
      expect(image?.image.info).toEqual({ format: "jpeg", width: 1024, height: 1024 })
      expect(dimensions(yield* image!.image.bytes())).toEqual({ width: 1024, height: 1024 })
      const finish = events.find(ImageEvent.is.finish)
      expect(finish?.usage).toMatchObject({ type: "tokens" })
      expect(finish?.providerMetadata).toEqual({
        openai: { outputFormat: "jpeg", size: "1024x1024", quality: "low", background: "opaque" },
      })
    }),
  )
})
