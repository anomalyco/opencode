import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image, Media } from "../../src/index.js"
import { Stability } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const stability = Stability.configure({ apiKey: process.env.STABILITY_API_KEY ?? "fixture" })

const recorded = recordedTests({
  prefix: "stability-images",
  provider: "stability",
  protocol: "stability-images",
  requires: ["STABILITY_API_KEY"],
  // Multipart boundaries change on every request, so bodies cannot be matched.
  options: { match: (incoming, recorded) => incoming.method === recorded.method && incoming.url === recorded.url },
})

describe("Stability Images recorded", () => {
  recorded.effect("generates an image inline", () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: stability.image("core"),
        prompt: "A simple flat black circle centered on a plain white background.",
        aspectRatio: "1:1",
        format: "jpeg",
      })

      expect(response.image.mediaType).toBe("image/jpeg")
      expect(response.providerMetadata).toMatchObject({ stability: { finishReason: "SUCCESS" } })
      expect(dimensions(yield* response.image.bytes()).width).toBeGreaterThan(0)
    }),
  )

  recorded.effect(
    "upscales an image through the results queue",
    () =>
      Effect.gen(function* () {
        const generation = yield* Image.start({
          model: stability.upscale(),
          prompt: "A simple flat black circle on a white background.",
          images: [
            Media.bytes(
              yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
              "image/jpeg",
            ),
          ],
          format: "jpeg",
        })
        const response = yield* generation.await({ poll: queuedPoll })

        expect(response.image.mediaType).toBe("image/jpeg")
        expect(dimensions(yield* response.image.bytes()).width).toBeGreaterThan(1024)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
