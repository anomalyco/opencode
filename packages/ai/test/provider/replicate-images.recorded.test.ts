import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/index.js"
import { Replicate } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = Replicate.configure({
  apiKey: process.env.REPLICATE_API_TOKEN ?? "fixture",
}).image("black-forest-labs/flux-schnell")

const recorded = recordedTests({
  prefix: "replicate-images",
  provider: "replicate",
  protocol: "replicate-images",
  requires: ["REPLICATE_API_TOKEN"],
})

describe("Replicate Images recorded", () => {
  recorded.effect(
    "waits for a prediction and reads its output",
    () =>
      Effect.gen(function* () {
        const response = yield* Image.generate(
          {
            model,
            prompt: "A simple flat black circle centered on a plain white background.",
            providerOptions: { aspect_ratio: "1:1", output_format: "webp", megapixels: "0.25" },
            http: { headers: { Prefer: "wait=60" } },
          },
          { poll: queuedPoll },
        )

        expect(response.images).toHaveLength(1)
        expect(response.image.source.type).toBe("url")
        expect(response.usage).toMatchObject({ type: "compute" })
        expect((yield* response.image.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
