import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ai, type VideoStatus } from "../../src/effect.js"
import { KlingAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

// Kling 2.5 Turbo at 720p is the cheapest Kling video ($0.042/s), and 5 seconds its shortest duration. Its models.dev
// ID (`kling-v2-5-turbo`) also covers the mapping to the `kling-2.5-turbo` path segment.
const model = KlingAI.configure({
  apiKey: process.env.KLINGAI_API_KEY ?? "fixture",
}).video("kling-v2-5-turbo")

const recorded = recordedTests({
  prefix: "klingai-video",
  provider: "klingai",
  protocol: "klingai-video",
  requires: ["KLINGAI_API_KEY"],
})

describe("Kling Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspect: "16:9",
          resolution: "720p",
          duration: "5 seconds",
        })
        const observed: Array<VideoStatus> = []
        yield* ai.video.status(model, job.token).pipe(
          Effect.tap((status) => Effect.sync(() => observed.push(status))),
          Effect.repeat({
            schedule: Schedule.spaced(queuedPoll.interval ?? "10 millis"),
            until: (status) => status.status !== "queued" && status.status !== "running",
          }),
        )
        expect(observed.at(-1)?.status).toBe("completed")

        const response = yield* ai.video.result(model, job.token)
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.expiresAt).toBeGreaterThan(0)
        expect(response.video.info?.durationSeconds).toBeGreaterThan(0)
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
