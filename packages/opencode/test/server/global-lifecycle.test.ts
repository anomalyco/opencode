import { beforeEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { reloadIfGlobalConfigChanged } from "@/server/global-lifecycle"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// Models the real Config service contract: a cached global config that only
// re-reads the file on invalidate().
function make() {
  let cached: object = {}
  let onDisk: object = {}
  let disposals = 0
  const layer = Layer.mergeAll(
    TestConfig.layer({
      getGlobal: () => Effect.sync(() => cached),
      invalidate: () =>
        Effect.sync(() => {
          cached = onDisk
        }),
    }),
    Layer.succeed(
      InstanceStore.Service,
      InstanceStore.Service.of({
        load: () => Effect.die("unexpected load"),
        reload: () => Effect.die("unexpected reload"),
        dispose: () => Effect.die("unexpected dispose"),
        disposeDirectory: () => Effect.die("unexpected disposeDirectory"),
        disposeAll: () =>
          Effect.sync(() => {
            disposals += 1
          }),
        provide: (_input, effect) => effect,
      }),
    ),
  )
  return {
    layer,
    get disposals() {
      return disposals
    },
    changeOnDisk(next: object) {
      onDisk = next
    },
    reset() {
      cached = {}
      onDisk = {}
      disposals = 0
    },
  }
}

const fx = make()
const it = testEffect(fx.layer)

beforeEach(() => fx.reset())

it.effect("leaves instances running when the global config is unchanged", () =>
  Effect.gen(function* () {
    const disposed = yield* reloadIfGlobalConfigChanged()
    expect(disposed).toBe(false)
    expect(fx.disposals).toBe(0)
  }),
)

it.effect("disposes instances when the global config changed on disk", () =>
  Effect.gen(function* () {
    fx.changeOnDisk({ username: "alice" })
    const disposed = yield* reloadIfGlobalConfigChanged()
    expect(disposed).toBe(true)
    expect(fx.disposals).toBe(1)
  }),
)

it.effect("does not dispose again once the change is absorbed", () =>
  Effect.gen(function* () {
    fx.changeOnDisk({ username: "alice" })
    expect(yield* reloadIfGlobalConfigChanged()).toBe(true)
    expect(yield* reloadIfGlobalConfigChanged()).toBe(false)
    expect(fx.disposals).toBe(1)
  }),
)
