import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, ImageInput } from "../../src"
import { XAI } from "../../src/providers"
import { dimensions } from "../lib/image"
import { recordedTests } from "../recorded-test"

const model = XAI.configure({
  apiKey: process.env.XAI_API_KEY ?? "fixture",
}).image("grok-imagine-image")

const recorded = recordedTests({
  prefix: "xai-images",
  provider: "xai",
  protocol: "xai-images",
  requires: ["XAI_API_KEY"],
})

describe("xAI Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat black diamond centered on a plain white background.",
        options: { aspectRatio: "1:1", resolution: "1k", responseFormat: "b64_json" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image?.mediaType.startsWith("image/")).toBe(true)
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      expect(response.image?.data.length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("edits an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "Keep the simple shape and change it from black to bright purple.",
        images: [
          ImageInput.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        options: { aspectRatio: "1:1", resolution: "1k", responseFormat: "b64_json" },
      })

      expect(response.image?.mediaType).toMatch(/^image\/(jpeg|png)$/)
      expect(response.image?.data).toBeInstanceOf(Uint8Array)
      if (!(response.image?.data instanceof Uint8Array)) throw new Error("Expected owned xAI image bytes")
      expect(dimensions(response.image.data)).toEqual({ width: 1024, height: 1024 })
    }),
  )
})
