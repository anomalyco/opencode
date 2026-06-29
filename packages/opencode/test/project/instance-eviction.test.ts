import { afterAll, beforeAll, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Duration, Effect, Layer } from "effect"
import { registerDisposer } from "../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Eviction reads OPENCODE_INSTANCE_* from Flag when the layer is built. Set it in
// beforeAll so it is in effect before each per-test layer build, and clear it after
// so other test files keep the default (disabled) behavior.
const TTL = 100
beforeAll(() => {
  process.env["OPENCODE_INSTANCE_IDLE_TTL_MS"] = String(TTL)
  process.env["OPENCODE_INSTANCE_SWEEP_MS"] = "20"
})
afterAll(() => {
  delete process.env["OPENCODE_INSTANCE_IDLE_TTL_MS"]
  delete process.env["OPENCODE_INSTANCE_SWEEP_MS"]
})

const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.void }),
)

const it = testEffect(
  Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(noopBootstrap)),
)

const registerDisposerScoped = (disposer: (directory: string) => Promise<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => registerDisposer(disposer)),
    (off) => Effect.sync(off),
  )

describe("InstanceStore eviction", () => {
  it.live("evicts an instance left idle past the TTL", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      yield* store.load({ directory: dir })
      expect(disposed).toEqual([])

      yield* Effect.sleep(Duration.millis(TTL * 6))
      expect(disposed).toContain(dir)
    }),
  )

  it.live("does not evict an instance while it is acquired (in use)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      yield* store.load({ directory: dir })
      yield* store.acquire(dir)

      yield* Effect.sleep(Duration.millis(TTL * 6))
      expect(disposed).toEqual([]) // pinned by active counter

      yield* store.release(dir)
      yield* Effect.sleep(Duration.millis(TTL * 6))
      expect(disposed).toContain(dir) // freed, now evictable
    }),
  )
})
