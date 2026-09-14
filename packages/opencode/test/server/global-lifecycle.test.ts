import { beforeEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { reloadIfConfigChanged } from "@/server/global-lifecycle"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

// Models the real Config service contract: a cached global config that only
// re-reads the file on invalidate(). `failReads` simulates a cached read that
// defects (e.g. a malformed config file) until the next invalidate.
function make() {
  let cached: object = {}
  let onDisk: object = {}
  let failReads = false
  let invalidations = 0
  let disposals = 0
  let inputsChanged = false
  const layer = Layer.mergeAll(
    TestConfig.layer({
      getGlobal: () => (failReads ? Effect.die("cached read failed") : Effect.sync(() => cached)),
      invalidate: () =>
        Effect.sync(() => {
          invalidations += 1
          cached = onDisk
          failReads = false
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
        configChanged: () => Effect.sync(() => inputsChanged),
      }),
    ),
  )
  return {
    layer,
    get disposals() {
      return disposals
    },
    get invalidations() {
      return invalidations
    },
    // Instances were built with `config` and the file matches it.
    set(config: object) {
      cached = config
      onDisk = config
    },
    // The file was edited on disk after instances booted.
    changeOnDisk(next: object) {
      onDisk = next
    },
    failReads() {
      failReads = true
    },
    setInputsChanged(next: boolean) {
      inputsChanged = next
    },
    reset() {
      cached = {}
      onDisk = {}
      failReads = false
      invalidations = 0
      disposals = 0
      inputsChanged = false
    },
  }
}

const fx = make()
const it = testEffect(fx.layer)

beforeEach(() => fx.reset())

it.effect("leaves instances running when the global config is unchanged", () =>
  Effect.gen(function* () {
    const disposed = yield* reloadIfConfigChanged()
    expect(disposed).toBe(false)
    expect(fx.disposals).toBe(0)
  }),
)

it.effect("disposes instances when the global config changed on disk", () =>
  Effect.gen(function* () {
    fx.changeOnDisk({ username: "alice" })
    const disposed = yield* reloadIfConfigChanged()
    expect(disposed).toBe(true)
    expect(fx.disposals).toBe(1)
  }),
)

it.effect("does not dispose again once the change is absorbed", () =>
  Effect.gen(function* () {
    fx.changeOnDisk({ username: "alice" })
    expect(yield* reloadIfConfigChanged()).toBe(true)
    expect(yield* reloadIfConfigChanged()).toBe(false)
    expect(fx.disposals).toBe(1)
  }),
)

it.effect("still invalidates when the cached read fails, and recovers on the next reload", () =>
  Effect.gen(function* () {
    fx.failReads()
    // A failed cached read cannot prove the config is unchanged, so the
    // historical disposal runs -- and, critically, the cache is invalidated
    // rather than left broken.
    expect(yield* reloadIfConfigChanged()).toBe(true)
    expect(fx.invalidations).toBe(1)
    expect(fx.disposals).toBe(1)
    // After the underlying file is readable again, the gate works normally.
    expect(yield* reloadIfConfigChanged()).toBe(false)
    expect(fx.disposals).toBe(1)
  }),
)

it.effect("ignores pure key reordering in the global config", () =>
  Effect.gen(function* () {
    fx.set({ username: "alice", logLevel: "DEBUG" })
    fx.changeOnDisk({ logLevel: "DEBUG", username: "alice" })
    const disposed = yield* reloadIfConfigChanged()
    expect(disposed).toBe(false)
    expect(fx.disposals).toBe(0)
  }),
)

it.effect("disposes instances when an instance's own config inputs changed", () =>
  Effect.gen(function* () {
    fx.setInputsChanged(true)
    const disposed = yield* reloadIfConfigChanged()
    expect(disposed).toBe(true)
    expect(fx.disposals).toBe(1)
  }),
)

it.effect("reloads when permission key order changes precedence", () =>
  Effect.gen(function* () {
    fx.set({ permission: { bash: { "git *": "deny", "*": "allow" } } })
    fx.changeOnDisk({ permission: { bash: { "*": "allow", "git *": "deny" } } })
    expect(yield* reloadIfConfigChanged()).toBe(true)
    expect(fx.disposals).toBe(1)
  }),
)
