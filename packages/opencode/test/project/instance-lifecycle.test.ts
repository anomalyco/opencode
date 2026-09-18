import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { BackgroundJob } from "@/background/job"
import { InstanceStore } from "../../src/project/instance-store"
import { registerDisposer } from "../../src/effect/instance-registry"
import {
  tmpdirScoped,
  testInstanceStoreLayer,
  provideInstanceEffect,
  reloadInstance,
  disposeAllInstances,
} from "../fixture/fixture"
import { testEffect, awaitWithTimeout } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  Layer.mergeAll(BackgroundJob.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(
    Layer.provide(testInstanceStoreLayer),
  ),
)

describe("instance lifecycle", () => {
  it.live("disposal completes when background jobs are active", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      yield* store.load({ directory: dir })

      yield* Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        yield* jobs.start({ type: "test", run: Effect.never })
      }).pipe(provideInstanceEffect(dir))

      yield* awaitWithTimeout(store.disposeAll(), "disposal deadlocked with active background job")
    }),
  )

  it.live("reload completes when background jobs are active", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      yield* store.load({ directory: dir })

      yield* Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        yield* jobs.start({ type: "test", run: Effect.never })
      }).pipe(provideInstanceEffect(dir))

      yield* awaitWithTimeout(
        reloadInstance({ directory: dir }),
        "reload deadlocked with active background job",
      )
    }),
  )

  it.live("disposal completes when a fiber is blocked on background.wait", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      yield* store.load({ directory: dir })

      yield* Effect.gen(function* () {
        const jobs = yield* BackgroundJob.Service
        const jobId = "lifecycle-wait-test"
        yield* jobs.start({ id: jobId, type: "test", run: Effect.never })

        yield* Effect.acquireUseRelease(
          Effect.void,
          () => jobs.wait({ id: jobId }),
          (_, exit) =>
            Exit.hasInterrupts(exit) ? jobs.cancel(jobId).pipe(Effect.ignore, Effect.forkDaemon, Effect.asVoid) : Effect.void,
        ).pipe(Effect.forkScoped)

        yield* Effect.yieldNow
      }).pipe(provideInstanceEffect(dir))

      yield* awaitWithTimeout(store.disposeAll(), "disposal deadlocked with fiber blocked on background.wait")
    }),
  )

  it.live("disposal timeout prevents a deadlocked disposer from hanging indefinitely", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      yield* store.load({ directory: dir })

      const off = registerDisposer(
        () => new Promise<void>(() => {}),
      )

      try {
        yield* awaitWithTimeout(
          store.disposeAll(),
          "disposal should have completed via timeout",
          "15 seconds",
        )
      } finally {
        off()
      }
    }),
    { timeout: 20_000 },
  )
})
