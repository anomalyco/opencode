import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { Media, ai, type VideoStatus } from "../../src/effect.js"
import { OpenRouter } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = OpenRouter.configure({
  apiKey: process.env.OPENROUTER_API_KEY ?? "fixture",
}).video("x-ai/grok-imagine-video-1.5-lite")

const recorded = recordedTests({
  prefix: "openrouter-video",
  provider: "openrouter",
  protocol: "openrouter-video",
  requires: ["OPENROUTER_API_KEY"],
})

describe("OpenRouter Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspect: "16:9",
          resolution: "480p",
          duration: "1 second",
        })
        const observed: Array<VideoStatus> = []
        yield* ai.video.status(model, job.id).pipe(
          Effect.tap((status) => Effect.sync(() => observed.push(status))),
          Effect.repeat({
            schedule: Schedule.spaced(queuedPoll.interval ?? "10 millis"),
            until: (status) => status.status !== "queued" && status.status !== "running",
          }),
        )
        // OpenRouter reports no progress, only queued, running and the terminal status.
        expect(observed.every((status) => status.progress === undefined)).toBe(true)
        expect(observed.at(-1)?.status).toBe("completed")

        const response = yield* ai.video.result(model, job.id)
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.expiresAt).toBeGreaterThan(Date.parse("2026-01-01"))
        // The content URL only downloads with the API key, which the result attaches to the asset.
        const bytes = yield* response.video.bytes()
        expect(Media.detectMediaType(bytes)).toBe("video/mp4")
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
