import { describe, expect, test } from "bun:test"
import { rpcError, startWire } from "./wire-fixture"

// A proxy in front of the server can answer the subscription request and then hold it open without
// forwarding anything, which is what a buffering tunnel does.
const buffered = (request: { readonly path: string; readonly method: string }) =>
  request.path === "/api/event" && request.method === "GET"
    ? new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } })
    : undefined

describe("acp event stream that opened", () => {
  test("a later request is served after the connect timeout has passed", async () => {
    await using wire = await startWire({ connectTimeout: "100 millis" })
    await wire.initialize()
    await wire.newSession()
    await Bun.sleep(300)
    await wire.newSession()
  })
})

describe("acp event stream that never opens", () => {
  test("opening a session fails with a clear error instead of hanging", async () => {
    await using wire = await startWire({ connectTimeout: "100 millis", fetch: buffered })
    await wire.initialize()
    const error = await rpcError(wire.newSession())
    expect(error.code).toBe(-32603)
    expect(error.data).toMatchObject({ errorName: "EventStreamUnavailable" })
    expect(error.message).toContain("sent no events within 0.1s")
  })

  test("a later request fails at once instead of waiting the timeout again", async () => {
    await using wire = await startWire({ connectTimeout: "100 millis", fetch: buffered })
    await wire.initialize()
    await rpcError(wire.newSession())
    const started = performance.now()
    await rpcError(wire.newSession())
    expect(performance.now() - started).toBeLessThan(50)
  })
})
