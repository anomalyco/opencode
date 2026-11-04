import { expect, test } from "bun:test"
import { Effect, Option, Scope, Tracer } from "effect"
import { HttpMiddleware, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"
import { withoutParentSpan } from "../src/request-tracing"

test("requests ignore ambient parents and continue inbound trace context", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const app = Effect.gen(function* () {
    yield* Scope.Scope
    return yield* HttpMiddleware.tracer(Effect.succeed(HttpServerResponse.empty()))
  })
  const request = (traceparent?: string) =>
    app.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request("http://localhost/trace", {
            headers: traceparent === undefined ? undefined : { traceparent },
          }),
        ),
      ),
      withoutParentSpan,
    )

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* request()
      yield* request()
      yield* request("00-11111111111111111111111111111111-2222222222222222-01")
      yield* Effect.yieldNow
    }).pipe(Effect.withSpan("fixture.lifecycle"), Effect.provideService(Tracer.Tracer, tracer), Effect.scoped),
  )

  const requests = spans.filter((span) => span.kind === "server")
  expect(requests).toHaveLength(3)
  expect(requests[0]?.traceId).not.toBe(requests[1]?.traceId)
  expect(Option.getOrUndefined(requests[0]?.parent ?? Option.none())).toBeUndefined()
  expect(Option.getOrUndefined(requests[1]?.parent ?? Option.none())).toBeUndefined()
  expect(requests[2]?.traceId).toBe("11111111111111111111111111111111")
  expect(Option.getOrUndefined(requests[2]?.parent ?? Option.none())?.spanId).toBe("2222222222222222")
})

it.live("handler spans nest under their request, not under server startup", () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
    })
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/session", HttpServer.formatAddress(server.address)), {
        method: "POST",
        headers: { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Traced" }),
      }),
    )
    expect(response.status).toBe(200)

    const startup = spans.find((span) => span.name === "ServerProcess.start")
    const request = spans.find((span) => span.kind === "server" && span.attributes.get("http.route") === "/api/session")
    const create = spans.find((span) => span.name === "Session.create")
    expect(request).toBeDefined()
    expect(Option.isNone(request!.parent)).toBe(true)
    expect(create?.traceId).toBe(request!.traceId)
    expect(create?.traceId).not.toBe(startup?.traceId)
  }).pipe(Effect.withTracer(tracer), Effect.scoped)
})
