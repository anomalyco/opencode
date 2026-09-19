import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { ConfigInteractive } from "@opencode-ai/core/config/interactive"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InteractiveGovernor } from "@opencode-ai/core/tool/interactive/governor"
import { tmpdir } from "./fixture/tmpdir"
import { configLayer } from "./fixture/config"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const withGovernor = <A, E, R>(
  body: (governor: InteractiveGovernor.Interface) => Effect.Effect<A, E, R>,
  interactive?: ConfigInteractive.Info,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const graph = AppNodeBuilder.build(InteractiveGovernor.node, [
        [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })))],
        [Config.node, configLayer(interactive ? { interactive } : {})],
      ])
      return Effect.gen(function* () {
        return yield* body(yield* InteractiveGovernor.Service)
      }).pipe(Effect.provide(graph))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const failWith = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    if (!Exit.isFailure(exit)) return yield* Effect.die("expected the effect to fail")
    return Option.getOrUndefined(Cause.findErrorOption(exit.cause))
  })

const it = testEffect(Layer.empty)

describe("InteractiveGovernor", () => {
  it.effect("budgets apply the documented defaults", () =>
    withGovernor((governor) =>
      Effect.gen(function* () {
        expect(yield* governor.budgets()).toEqual({
          maxJobs: 3,
          maxExchanges: 20,
          quietWindowMs: 500,
          waitTimeoutMs: 120_000,
          defaultTimeoutMs: 900_000,
          maxSpoolBytes: 8_388_608,
        })
      }),
    ))

  it.effect("budgets read the configured interactive values", () =>
    withGovernor(
      (governor) =>
        Effect.gen(function* () {
          expect(yield* governor.budgets()).toEqual({
            maxJobs: 2,
            maxExchanges: 5,
            quietWindowMs: 40,
            waitTimeoutMs: 5_000,
            defaultTimeoutMs: 60_000,
            maxSpoolBytes: 1024,
          })
        }),
      new ConfigInteractive.Info({
        max_jobs: 2,
        max_exchanges: 5,
        quiet_window_ms: 40,
        wait_timeout_ms: 5_000,
        default_timeout_ms: 60_000,
        max_spool_bytes: 1024,
      }),
    ))

  it.effect("assertStartAllowed fails at max_jobs listing the live job ids", () =>
    withGovernor(
      (governor) =>
        Effect.gen(function* () {
          yield* governor.assertStartAllowed([])
          yield* governor.assertStartAllowed(["ijob_a"])
          const error = yield* failWith(governor.assertStartAllowed(["ijob_a", "ijob_b"]))
          expect(error?._tag).toBe("InteractiveGovernor.TooManyJobsError")
          if (error?._tag === "InteractiveGovernor.TooManyJobsError")
            expect(error.liveJobIDs).toEqual(["ijob_a", "ijob_b"])
        }),
      new ConfigInteractive.Info({ max_jobs: 2 }),
    ))

  it.effect("consumeExchange allows up to max_exchanges and then exhausts", () =>
    withGovernor(
      (governor) =>
        Effect.gen(function* () {
          expect(yield* governor.consumeExchange("ijob_a", 0)).toEqual({
            _tag: "Allowed",
            exchangesRemaining: 1,
          })
          expect(yield* governor.consumeExchange("ijob_a", 1)).toEqual({
            _tag: "Allowed",
            exchangesRemaining: 0,
          })
          expect(yield* governor.consumeExchange("ijob_a", 2)).toEqual({ _tag: "Exhausted" })
        }),
      new ConfigInteractive.Info({ max_exchanges: 2 }),
    ))

  it.effect("lifetimeMs honors requests, applies the default, and clamps to the hard cap", () =>
    withGovernor(
      (governor) =>
        Effect.gen(function* () {
          expect(yield* governor.lifetimeMs()).toBe(45_000)
          expect(yield* governor.lifetimeMs(1_234)).toBe(1_234)
          expect(yield* governor.lifetimeMs(10_000_000)).toBe(3_600_000)
        }),
      new ConfigInteractive.Info({ default_timeout_ms: 45_000 }),
    ))

  it.effect("waitDeadlineMs honors requests, applies the default, and clamps to the hard cap", () =>
    withGovernor(
      (governor) =>
        Effect.gen(function* () {
          expect(yield* governor.waitDeadlineMs()).toBe(7_000)
          expect(yield* governor.waitDeadlineMs(250)).toBe(250)
          expect(yield* governor.waitDeadlineMs(10_000_000)).toBe(600_000)
        }),
      new ConfigInteractive.Info({ wait_timeout_ms: 7_000 }),
    ))
})
