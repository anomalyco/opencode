import { expect, test } from "bun:test"
import { Effect } from "effect"
import { BackgroundServiceState } from "./background-service-state"

test("new consumers receive the latest reconnected service", async () => {
  const initial = { url: "http://127.0.0.1:4100", password: "first" }
  const replacement = { url: "http://127.0.0.1:4200", password: "second" }
  const service = await Effect.runPromise(
    BackgroundServiceState.make({ initial: Effect.succeed(initial), reconnect: Effect.succeed(replacement) }),
  )

  expect(await Effect.runPromise(service.connection)).toEqual(initial)
  expect(await Effect.runPromise(service.reconnect)).toEqual(replacement)
  expect(await Effect.runPromise(service.connection)).toEqual(replacement)
})
