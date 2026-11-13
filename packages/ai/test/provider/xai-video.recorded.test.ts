import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ai, type VideoStatus } from "../../src/effect.js"
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
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspect: "16:9",
          resolution: "480p",
          duration: "2 seconds",
        })
        const observed: Array<VideoStatus> = []
        yield* ai.video.status(model, job.token).pipe(
          Effect.tap((status) => Effect.sync(() => observed.push(status))),
          Effect.repeat({
            schedule: Schedule.spaced(queuedPoll.interval ?? "10 millis"),
            until: (status) => status.status !== "queued" && status.status !== "running",
          }),
        )
        const progress = observed.flatMap((status) => (status.progress === undefined ? [] : [status.progress]))
        // xAI reports progress as a percentage; the route normalizes it to a monotonic 0..1 fraction.
        expect(progress.length).toBeGreaterThan(0)
        expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true)
        expect(progress).toEqual([...progress].sort((a, b) => a - b))
        expect(observed.at(-1)?.status).toBe("completed")

        const response = yield* ai.video.result(model, job.token)
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.info?.durationSeconds).toBe(2)
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
