import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ai, type VideoStatus } from "../../src/effect.js"
import { BytePlus } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

// Seedance 2.0 mini is the cheapest 2.x model; 480p and 4 seconds are the lowest settings it accepts.
const model = BytePlus.configure({
  apiKey: process.env.BYTEPLUS_API_KEY ?? "fixture",
}).video("dreamina-seedance-2-0-mini-260615")

const recorded = recordedTests({
  prefix: "seedance-video",
  provider: "byteplus",
  protocol: "seedance-video",
  requires: ["BYTEPLUS_API_KEY"],
})

describe("Seedance Video recorded", () => {
  recorded.effect(
    "generates a video",
    () =>
      Effect.gen(function* () {
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspect: "16:9",
          resolution: "480p",
          duration: "4 seconds",
          sound: false,
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
        expect(response.video.source.type).toBe("url")
        expect(response.video.expiresAt).toBeGreaterThan(0)
        expect(response.usage?.type).toBe("tokens")
        expect((yield* response.video.bytes()).length).toBeGreaterThan(0)
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
