import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, Media } from "../../src/effect.js"
import { MiniMax } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const model = MiniMax.configure({ apiKey: process.env.MINIMAX_API_KEY ?? "fixture" }).image("image-01")

const recorded = recordedTests({
  prefix: "minimax-images",
  provider: "minimax",
  protocol: "minimax-images",
  requires: ["MINIMAX_API_KEY"],
})

describe("MiniMax Images recorded", () => {
  recorded.effect("generates an image", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "A simple flat red circle centered on a plain white background.",
        aspect: "1:1",
        resolution: "0.5K",
      })

      expect(response.images).toHaveLength(1)
      expect(response.image.mediaType).toMatch(/^image\/(jpeg|png)$/)
      expect(dimensions(yield* response.image.bytes())).toEqual({ width: 512, height: 512 })
      expect(response.providerMetadata?.minimax).toBeDefined()
    }),
  )

  recorded.effect("generates from a subject reference", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model,
        prompt: "The same woman reading a book in a quiet library, soft window light.",
        // MiniMax's own documentation portrait.
        images: [
          Media.url(
            "https://cdn.hailuoai.com/prod/2025-08-12-17/video_cover/1754990600020238321-411603868533342214-cover.jpg",
          ),
        ],
        resolution: "0.5K",
      })

      expect(response.images).toHaveLength(1)
      expect(dimensions(yield* response.image.bytes())).toEqual({ width: 512, height: 512 })
    }),
  )
})
