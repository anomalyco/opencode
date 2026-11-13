import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { ai, type VideoModel, type VideoStatus } from "../../src/effect.js"
import { MiniMax } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const minimax = MiniMax.configure({ apiKey: process.env.MINIMAX_API_KEY ?? "fixture" })

const recorded = recordedTests({
  prefix: "minimax-video",
  provider: "minimax",
  protocol: "minimax-video",
  requires: ["MINIMAX_API_KEY"],
})

const settle = (model: VideoModel, token: unknown) =>
  Effect.gen(function* () {
    const observed: Array<VideoStatus> = []
    yield* ai.video.status(model, token).pipe(
      Effect.tap((status) => Effect.sync(() => observed.push(status))),
      Effect.repeat({
        schedule: Schedule.spaced(queuedPoll.interval ?? "10 millis"),
        until: (status) => status.status !== "queued" && status.status !== "running",
      }),
    )
    return observed
  })

describe("MiniMax Video recorded", () => {
  recorded.effect(
    "generates an H3 video",
    () =>
      Effect.gen(function* () {
        const model = minimax.video("MiniMax-H3-Lite")
        // H3 needs resolution and duration, and a ratio when the prompt is the only input.
        const job = yield* ai.video.start({
          model,
          prompt: "A single red balloon drifting slowly upward against a clear blue sky.",
          aspect: "16:9",
          resolution: "480p",
          duration: "4 seconds",
        })
        const observed = yield* settle(model, job.token)
        expect(observed.at(-1)?.status).toBe("completed")

        const response = yield* ai.video.result(model, job.token)
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.info?.durationSeconds).toBe(4)
        expect(response.usage).toEqual({ type: "seconds", seconds: 4 })
        expect(response.providerMetadata?.minimax).toMatchObject({ model: "MiniMax-H3-Lite", resolution: "480P" })
      }),
    { timeout: 15 * 60 * 1000 },
  )

  recorded.effect(
    "generates a Hailuo video from a first frame",
    () =>
      Effect.gen(function* () {
        const model = minimax.video("MiniMax-Hailuo-02")
        const job = yield* ai.video.start({
          model,
          prompt: "The woman slowly turns her head and smiles.",
          // MiniMax's own documentation portrait.
          start:
            "https://cdn.hailuoai.com/prod/2025-08-12-17/video_cover/1754990600020238321-411603868533342214-cover.jpg",
          resolution: "512p",
          duration: "6 seconds",
        })
        const observed = yield* settle(model, job.token)
        expect(observed.at(-1)?.status).toBe("completed")

        // The task names a file; the result looks up its one-hour download URL.
        const response = yield* ai.video.result(model, job.token)
        expect(response.videos).toHaveLength(1)
        expect(response.video.source.type).toBe("url")
        expect(response.video.expiresAt).toBeGreaterThan(0)
        expect(response.providerMetadata?.minimax).toMatchObject({ taskId: job.id })
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
