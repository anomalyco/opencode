import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Video } from "../../src/index.js"
import { Fal } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = Fal.configure({
  apiKey: process.env.FAL_KEY ?? "fixture",
}).video("fal-ai/veo3.1/fast")

const recorded = recordedTests({
  prefix: "fal-video",
  provider: "fal",
  protocol: "fal-video",
  requires: ["FAL_KEY"],
})

describe("fal Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const response = yield* Video.generate(
          {
            model,
            prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
            aspectRatio: "16:9",
            resolution: "720p",
            providerOptions: { duration: "4s" },
          },
          { poll: queuedPoll },
        )

        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
