import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Video } from "../../src/index.js"
import { Google } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { videoPoll } from "./video-recording.js"

const model = Google.configure({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
}).video("veo-3.1-fast-generate-preview")

const recorded = recordedTests({
  prefix: "google-video",
  provider: "google",
  protocol: "google-video",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})

describe("Google Veo recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const response = yield* Video.generate(
          {
            model,
            prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
            aspectRatio: "16:9",
            durationSeconds: 4,
          },
          { poll: videoPoll },
        )

        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.headers?.["x-goog-api-key"]).toBeString()
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
