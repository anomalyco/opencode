import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { fetchLayer } from "./effect/app-node-platform.js"
import { create } from "./undici-fetch.node.js"

const stub = (name: string) => Object.assign(async () => new Response(name), { preconnect: fetch.preconnect })

const resolve = (layer: ReturnType<typeof fetchLayer>) =>
  Effect.runPromise(Effect.gen(function* () {
    return yield* FetchHttpClient.Fetch
  }).pipe(Effect.provide(layer)))

describe("undici fetch", () => {
  // Node's built-in fetch enforces undici's 300s headers/body timeouts and cannot take an
  // undici@8 Agent (UND_ERR_INVALID_ARG), so the Agent only works paired with undici's own fetch.
  test("keeps the runtime fetch under Bun, which has no such timeouts", () => {
    expect(create({ bun: "1.3.0" })).toBeUndefined()
  })

  test("replaces the runtime fetch under Node", () => {
    expect(create({})).toBeFunction()
  })

  test("fetchLayer sends through the runtime's fetch when it has one", async () => {
    const send = stub("undici")
    expect(await resolve(fetchLayer(undefined, () => send))).toBe(send)
  })

  test("fetchLayer keeps the fetch in scope when the runtime has none", async () => {
    expect(await resolve(fetchLayer(undefined, () => undefined))).toBe(globalThis.fetch)
  })

  test("an embedder's fetch wins over the runtime's", async () => {
    const embedder = stub("embedder")
    expect(await resolve(fetchLayer(embedder, () => stub("undici")))).toBe(embedder)
  })
})
