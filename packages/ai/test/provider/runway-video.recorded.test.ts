import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Video } from "../../src/index.js"
import { Runway } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { videoPoll } from "./video-recording.js"

const model = Runway.configure({
  apiKey: process.env.RUNWAYML_API_SECRET ?? "fixture",
}).video("gen4.5")

const recorded = recordedTests({
  prefix: "runway-video",
  provider: "runway",
  protocol: "runway-video",
  requires: ["RUNWAYML_API_SECRET"],
})

describe("Runway recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const response = yield* Video.generate(
          {
            model,
            prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
            aspectRatio: "1280:720",
            durationSeconds: 2,
          },
          { poll: videoPoll },
        )

        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.usage?.type).toBe("credits")
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
