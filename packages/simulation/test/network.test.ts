import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/unstable/http"
import { SimulationNetwork } from "../src/backend/network"

test("keeps routes and request logs local to each network", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_234)
        const first = yield* SimulationNetwork.make([
          SimulationNetwork.json("GET", "https://example.test/value", { source: "first" }),
        ])
        const second = yield* SimulationNetwork.make()
        const request = HttpClientRequest.get("https://example.test/value")

        const response = yield* first.client.execute(request)
        expect(yield* response.text).toBe('{"source":"first"}')
        expect(Exit.isFailure(yield* second.client.execute(request).pipe(Effect.exit))).toBe(true)

        expect(yield* first.log()).toEqual([
          { time: 1_234, method: "GET", url: "https://example.test/value", matched: true },
        ])
        expect(yield* second.log()).toEqual([
          { time: 1_234, method: "GET", url: "https://example.test/value", matched: false },
        ])
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  )
})
