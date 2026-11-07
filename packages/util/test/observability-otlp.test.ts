import { expect, test } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpExporter, OtlpSerialization } from "effect/observability"
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

for (const signal of ["logs", "traces"] as const) {
  test(`decodes configured OTLP header values for ${signal}`, async () => {
    const headers: Record<string, string>[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        headers.push(Object.fromEntries(request.headers))
        await request.arrayBuffer()
        return Response.json({})
      },
    })

    try {
      await Effect.gen(function* () {
        const options = {
          endpoint: server.url.origin,
          headers:
            "Authorization=Bearer%20test-token,x-otel-test=comma%2Cequals%3Dpercent%25plus%2B,x-raw=a=b,x-invalid=bad%escape",
        }
        const app = { client: "test", version: "1.0.0", channel: "local" }
        if (signal === "logs") {
          yield* Effect.logInfo("otlp-header-test").pipe(
            Effect.provide(
              Logger.layer(Otlp.loggers(options, app)).pipe(
                Layer.provide(OtlpSerialization.layerJson),
                Layer.provide(FetchHttpClient.layer),
                Layer.provide(OtlpExporter.layerFlusher),
              ),
            ),
          )
          return
        }
        const tracing = yield* Otlp.tracingLayer(options, app)
        yield* Effect.void.pipe(Effect.withSpan("otlp-header-test"), Effect.provide(tracing))
      }).pipe(Effect.scoped, Effect.runPromise)

      expect(headers).toHaveLength(1)
      expect(headers[0]).toMatchObject({
        authorization: "Bearer test-token",
        "x-otel-test": "comma,equals=percent%plus+",
        "x-raw": "a=b",
      })
      expect(headers[0]).not.toHaveProperty("x-invalid")
    } finally {
      server.stop(true)
    }
  })
}
