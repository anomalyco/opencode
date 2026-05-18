import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ProviderConcurrency } from "@/provider/concurrency"
import { ProviderID } from "@/provider/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(ProviderConcurrency.defaultLayer)

const opts = (overrides: {
  providerID: ProviderID
  modelID?: string
  providerMaxConcurrency?: number
  modelMaxConcurrency?: number
  concurrencyCost?: number
}) => ({
  providerID: overrides.providerID,
  modelID: overrides.modelID ?? "m",
  providerMaxConcurrency: overrides.providerMaxConcurrency,
  modelMaxConcurrency: overrides.modelMaxConcurrency,
  concurrencyCost: overrides.concurrencyCost,
})

describe("provider.concurrency", () => {
  it.live("serializes acquires for the same provider", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("featherless")

      let active = 0
      let max = 0

      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(opts({ providerID: pid, providerMaxConcurrency: 1 }))
          active++
          max = Math.max(max, active)
          yield* Effect.sleep("20 millis")
          active--
        }),
      )

      yield* Effect.all([work, work, work], { concurrency: "unbounded" })

      expect(max).toBe(1)
    }),
  )

  it.live("isolates different providers", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const a = ProviderID.make("a")
      const b = ProviderID.make("b")

      let active = 0
      let max = 0

      const work = (pid: ProviderID) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* svc.acquire(opts({ providerID: pid, providerMaxConcurrency: 1 }))
            active++
            max = Math.max(max, active)
            yield* Effect.sleep("20 millis")
            active--
          }),
        )

      yield* Effect.all([work(a), work(b)], { concurrency: "unbounded" })

      expect(max).toBe(2)
    }),
  )

  it.live("no limits configured does not block", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("nolimit")

      let active = 0
      let max = 0

      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(opts({ providerID: pid }))
          active++
          max = Math.max(max, active)
          yield* Effect.sleep("20 millis")
          active--
        }),
      )

      yield* Effect.all([work, work, work], { concurrency: "unbounded" })

      expect(max).toBe(3)
    }),
  )

  it.live("releases the permit when the scope closes", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("seq")

      const order: string[] = []

      const work = (name: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* svc.acquire(opts({ providerID: pid, providerMaxConcurrency: 1 }))
            order.push(`${name}:start`)
            yield* Effect.sleep("10 millis")
            order.push(`${name}:end`)
          }),
        )

      yield* Effect.all([work("A"), work("B")], { concurrency: "unbounded" })

      const firstStart = order[0].split(":")[0]
      const firstEnd = order[1].split(":")[0]
      expect(firstStart).toBe(firstEnd)
    }),
  )

  it.live("weighted cost limits concurrency against the provider budget", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("featherless-weighted")

      let active = 0
      let max = 0

      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(opts({ providerID: pid, providerMaxConcurrency: 4, concurrencyCost: 4 }))
          active++
          max = Math.max(max, active)
          yield* Effect.sleep("20 millis")
          active--
        }),
      )

      yield* Effect.all([work, work, work], { concurrency: "unbounded" })

      expect(max).toBe(1)
    }),
  )

  it.live("models with different costs share the provider budget", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("featherless-mixed")

      let active = 0
      let max = 0

      const work = (modelID: string, cost: number) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* svc.acquire(opts({ providerID: pid, modelID, providerMaxConcurrency: 4, concurrencyCost: cost }))
            active++
            max = Math.max(max, active)
            yield* Effect.sleep("20 millis")
            active--
          }),
        )

      yield* Effect.all([work("big", 4), work("small", 1), work("small", 1)], { concurrency: "unbounded" })

      expect(max).toBe(2)
    }),
  )

  it.live("per-model maxConcurrency uses an independent semaphore per model", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("glm")

      let active = 0
      let max = 0

      const work = (modelID: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* svc.acquire(opts({ providerID: pid, modelID, modelMaxConcurrency: 1 }))
            active++
            max = Math.max(max, active)
            yield* Effect.sleep("20 millis")
            active--
          }),
        )

      yield* Effect.all([work("glm-air"), work("glm-plus")], { concurrency: "unbounded" })

      expect(max).toBe(2)
    }),
  )

  it.live("model and provider caps both apply when both are configured", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("stacked")

      let active = 0
      let max = 0

      // Provider budget allows 4 in parallel, but per-model cap is 1: the tighter cap wins.
      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(
            opts({ providerID: pid, modelID: "m", providerMaxConcurrency: 4, modelMaxConcurrency: 1 }),
          )
          active++
          max = Math.max(max, active)
          yield* Effect.sleep("20 millis")
          active--
        }),
      )

      yield* Effect.all([work, work, work], { concurrency: "unbounded" })

      expect(max).toBe(1)
    }),
  )

  it.live("stacked caps still count weighted cost against the provider budget", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("stacked-weighted")

      let active = 0
      let max = 0

      // Two different models, each capped at 1 individually, but each costs 4 against a 4-unit provider budget.
      // Provider budget should still serialize them across models.
      const work = (modelID: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* svc.acquire(
              opts({
                providerID: pid,
                modelID,
                providerMaxConcurrency: 4,
                modelMaxConcurrency: 1,
                concurrencyCost: 4,
              }),
            )
            active++
            max = Math.max(max, active)
            yield* Effect.sleep("20 millis")
            active--
          }),
        )

      yield* Effect.all([work("kimi"), work("deepseek")], { concurrency: "unbounded" })

      expect(max).toBe(1)
    }),
  )
})
