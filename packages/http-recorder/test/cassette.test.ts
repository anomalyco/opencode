import { expect, test } from "bun:test"
import { Effect } from "effect"
import { memory, Service } from "../src/cassette/store"

test("memory cassettes append and replay interactions", async () => {
  const interaction = {
    transport: "http" as const,
    request: { method: "GET", url: "https://example.test", headers: {}, body: "" },
    response: { status: 200, headers: {}, body: "ok" },
  }
  const stored = await Effect.runPromise(
    Effect.gen(function* () {
      const cassette = yield* Service
      yield* cassette.append("example", interaction)
      return yield* cassette.read("example")
    }).pipe(Effect.provide(memory())),
  )
  expect(stored).toEqual([interaction])
})
