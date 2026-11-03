import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Otlp } from "../src/observability/otlp.js"

test("exports a span through the configured OTLP trace endpoint", async () => {
  const requests: unknown[] = []
  const headers: string[] = []
  const paths: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      paths.push(new URL(request.url).pathname)
      headers.push(request.headers.get("x-otel-test") ?? "")
      requests.push(await request.json())
      return Response.json({})
    },
  })

  try {
    await Effect.gen(function* () {
      const tracing = yield* Otlp.tracingLayer(
        { endpoint: server.url.origin, headers: "x-otel-test=present" },
        { client: "test", version: "1.0.0", channel: "local" },
      )
      yield* Effect.void.pipe(Effect.withSpan("otlp-smoke"), Effect.provide(tracing))
    }).pipe(Effect.scoped, Effect.runPromise)

    expect(requests).toHaveLength(1)
    expect(paths).toEqual(["/v1/traces"])
    expect(headers).toEqual(["present"])
    expect(requests[0]).toMatchObject({
      resourceSpans: [
        {
          resource: {
            attributes: expect.arrayContaining([{ key: "service.name", value: { stringValue: "opencode" } }]),
          },
          scopeSpans: [{ spans: [expect.objectContaining({ name: "otlp-smoke" })] }],
        },
      ],
    })
  } finally {
    server.stop(true)
  }
})
