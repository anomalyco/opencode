import { describe, expect, test } from "bun:test"
import { rpcError, startSession } from "./wire-fixture"

// A proxy in front of the server can answer the subscription request and then hold it open without
// forwarding anything, which is what a buffering tunnel does.
const buffered = (request: { readonly path: string; readonly method: string }) =>
  request.path === "/api/event" && request.method === "GET"
    ? new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } })
    : undefined

describe("acp event stream that never opens", () => {
  test("a turn fails with a clear error instead of hanging", async () => {
    await using wire = await startSession({ connectTimeout: "100 millis", fetch: buffered })
    const error = await rpcError(wire.prompt(wire.sessionId, "hello"))
    expect(error.code).toBe(-32603)
    expect(error.data).toMatchObject({ errorName: "EventStreamUnavailable" })
    expect(error.message).toContain("sent no events within 0.1s")
    expect(wire.server.prompts).toEqual([])
  })

  test("a session still opens, since only event ordering waits on the stream", async () => {
    await using wire = await startSession({ connectTimeout: "100 millis", fetch: buffered })
    expect(wire.sessionId).toBeTruthy()
  })
})
