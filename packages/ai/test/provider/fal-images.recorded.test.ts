import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/index.js"
import { Fal } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = Fal.configure({
  apiKey: process.env.FAL_KEY ?? "fixture",
}).image("fal-ai/flux/schnell")

const recorded = recordedTests({
  prefix: "fal-images",
  provider: "fal",
  protocol: "fal-images",
  requires: ["FAL_KEY"],
})

describe("fal Images recorded", () => {
  recorded.effect(
    "generates an image",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate(
          {
            model,
            prompt: "A simple flat black circle centered on a plain white background.",
            size: "512x512",
            format: "jpeg",
          },
          { poll: queuedPoll },
        )

        expect(response.images).toHaveLength(1)
        expect(response.image.info).toEqual({ width: 512, height: 512 })
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 512, height: 512 })
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
