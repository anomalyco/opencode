import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ProviderConcurrency } from "@/provider/concurrency"
import { ProviderID } from "@/provider/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(ProviderConcurrency.defaultLayer)

describe("provider.concurrency", () => {
  it.live("serializes acquires for the same provider", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("featherless")

      let active = 0
      let max = 0

      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(pid, 1)
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
            yield* svc.acquire(pid, 1)
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

  it.live("undefined maxConcurrency does not block", () =>
    Effect.gen(function* () {
      const svc = yield* ProviderConcurrency.Service
      const pid = ProviderID.make("nolimit")

      let active = 0
      let max = 0

      const work = Effect.scoped(
        Effect.gen(function* () {
          yield* svc.acquire(pid, undefined)
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
            yield* svc.acquire(pid, 1)
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
})
