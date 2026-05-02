import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(BackgroundJob.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("background.job", () => {
  it.live("tracks started jobs through completion", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const latch = yield* Deferred.make<void>()
        const job = yield* jobs.start({
          type: "test",
          title: "test job",
          run: Deferred.await(latch).pipe(Effect.as("done")),
        })

        expect(job.status).toBe("running")
        yield* Deferred.succeed(latch, undefined)
        const done = yield* jobs.wait({ id: job.id })

        expect(done.info?.status).toBe("completed")
        expect(done.info?.output).toBe("done")
        expect((yield* jobs.list()).map((item) => item.id)).toEqual([job.id])
      }),
    ),
  )

  it.live("can cancel running jobs", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const latch = yield* Deferred.make<void>()
        const job = yield* jobs.start({
          type: "test",
          run: Deferred.await(latch).pipe(Effect.as("done")),
        })

        const cancelled = yield* jobs.cancel(job.id)

        expect(cancelled?.status).toBe("cancelled")
      }),
    ),
  )
})
