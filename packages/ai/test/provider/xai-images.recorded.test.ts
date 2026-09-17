import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, Media } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

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
        aspectRatio: "1:1",
        providerOptions: { resolution: "1k", responseFormat: "b64_json" },
      })

      expect(response.images).toHaveLength(1)
      expect(response.image.mediaType.startsWith("image/")).toBe(true)
      expect((yield* response.image.bytes()).length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("edits an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "Keep the simple shape and change it from black to bright purple.",
        images: [
          Media.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        aspectRatio: "1:1",
        providerOptions: { resolution: "1k", responseFormat: "b64_json" },
      })

      expect(response.image.mediaType).toMatch(/^image\/(jpeg|png)$/)
      expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1024, height: 1024 })
    }),
  )
})
