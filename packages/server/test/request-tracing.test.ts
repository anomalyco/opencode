import { expect, test } from "bun:test"
import { Effect, Option, Scope, Tracer } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
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
