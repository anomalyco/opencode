import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Schema, Scope } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { testEffect } from "../lib/effect"

const contribution = (key: string, text: string, sourceKey = key) => ({
  key: SystemContext.Key.make(key),
  load: Effect.succeed(
    SystemContext.make({
      key: SystemContext.Key.make(sourceKey),
      codec: Schema.toCodecJson(Schema.String),
      load: Effect.succeed(text),
      baseline: String,
      update: (_previous, current) => current,
    }),
  ),
})

const it = testEffect(SystemContextRegistry.layer)

describe("SystemContextRegistry", () => {
  it.effect("loads empty system context when there are no contributions", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      expect(yield* SystemContext.initialize(yield* registry.load())).toEqual({ baseline: "", snapshot: {} })
    }),
  )

  it.effect("loads scoped contributions in stable key order", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.contribute(contribution("test/second", "second"))
      yield* registry.contribute(contribution("test/first", "first"))

      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("first\n\nsecond")
    }),
  )

  it.effect("re-evaluates contribution producers on each load", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      let loads = 0
      yield* registry.contribute({
        key: SystemContext.Key.make("test/dynamic"),
        load: Effect.sync(() => {
          loads++
          return SystemContext.empty
        }),
      })

      yield* registry.load()
      yield* registry.load()

      expect(loads).toBe(2)
    }),
  )

  it.effect("propagates contribution producer failures", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const failure = new Error("contribution failed")
      yield* registry.contribute({ key: SystemContext.Key.make("test/failure"), load: Effect.die(failure) })

      const exit = yield* registry.load().pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure)
    }),
  )

  it.effect("rejects duplicate source keys from separate contributions", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.contribute(contribution("test/first", "first", "test/duplicate"))
      yield* registry.contribute(contribution("test/second", "second", "test/duplicate"))

      const exit = yield* registry.load().pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBeInstanceOf(SystemContext.DuplicateKeyError)
        expect(Cause.squash(exit.cause)).toMatchObject({ key: SystemContext.Key.make("test/duplicate") })
      }
    }),
  )

  it.effect("rejects duplicate contribution keys", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* registry.contribute(contribution("test/duplicate", "first"))

      const exit = yield* registry.contribute(contribution("test/duplicate", "second", "test/other")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Duplicate system context contribution key")
    }),
  )

  it.effect("removes a contribution when its owning scope closes", () =>
    Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const scope = yield* Scope.make()
      yield* registry.contribute(contribution("test/scoped", "scoped")).pipe(Scope.provide(scope))

      expect((yield* SystemContext.initialize(yield* registry.load())).baseline).toBe("scoped")

      yield* Scope.close(scope, Exit.void)
      expect(yield* SystemContext.initialize(yield* registry.load())).toEqual({ baseline: "", snapshot: {} })
    }),
  )
})
