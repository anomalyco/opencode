import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Video } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = XAI.configure({
  apiKey: process.env.XAI_API_KEY ?? "fixture",
}).video("grok-imagine-video-1.5")

const recorded = recordedTests({
  prefix: "xai-video",
  provider: "xai",
  protocol: "xai-video",
  requires: ["XAI_API_KEY"],
})

describe("xAI Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const generation = yield* Video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspectRatio: "16:9",
          resolution: "480p",
          durationSeconds: 2,
        })
        const observed = yield* generation.events({ poll: queuedPoll }).pipe(Stream.runCollect)
        const progress = Array.from(observed).flatMap((event) =>
          event.type === "generation-progress" && event.progress !== undefined ? [event.progress] : [],
        )
        // xAI reports progress as a percentage; the route normalizes it to a monotonic 0..1 fraction.
        expect(progress.length).toBeGreaterThan(0)
        expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true)
        expect(progress).toEqual([...progress].sort((a, b) => a - b))

        const response = yield* generation.result()
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.info?.durationSeconds).toBe(2)
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
