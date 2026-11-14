import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ai, type VideoStatus } from "../../src/effect.js"
import { Google } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = Google.configure({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture",
}).video("gemini-omni-1.2-flash")

const recorded = recordedTests({
  prefix: "google-interactions-video",
  provider: "google",
  protocol: "google-interactions-video",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})

describe("Google Interactions Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky. No dialogue.",
          aspect: "16:9",
          resolution: "360p",
          duration: "3 seconds",
        })
        const observed: Array<VideoStatus> = []
        yield* ai.video.status(model, job.id).pipe(
          Effect.tap((status) => Effect.sync(() => observed.push(status))),
          Effect.repeat({
            schedule: Schedule.spaced(queuedPoll.interval ?? "10 millis"),
            until: (status) => status.status !== "queued" && status.status !== "running",
          }),
        )
        expect(observed.at(-1)?.status).toBe("completed")

        const response = yield* ai.video.result(model, job.id)
        expect(response.videos).toHaveLength(1)
        expect(response.video.mediaType).toBe("video/mp4")
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
