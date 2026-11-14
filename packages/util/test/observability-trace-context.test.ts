import { expect, test } from "bun:test"
import { makeExternalSpan } from "@effect/opentelemetry/OtelTracer"
import { baggageEntryMetadataFromString, context, propagation } from "@opentelemetry/api"
import { Effect, References } from "effect"
import { Otlp } from "../src/observability/otlp.js"
import { TraceContext } from "../src/observability/trace-context.js"

const parent = makeExternalSpan({
  traceId: "11111111111111111111111111111111",
  spanId: "2222222222222222",
  traceFlags: 0,
  traceState: "vendor=value",
})

test("preserves external trace state and unsampled flags without a global propagator", async () => {
  expect(await Effect.runPromise(TraceContext.current.pipe(Effect.withParentSpan(parent)))).toEqual({
    traceparent: "00-11111111111111111111111111111111-2222222222222222-00",
    tracestate: "vendor=value",
  })
})

test("omits context when absent, disabled, or explicitly non-propagating", async () => {
  expect(await Effect.runPromise(TraceContext.current)).toBeUndefined()
  expect(
    await Effect.runPromise(TraceContext.current.pipe(Effect.withTracerEnabled(false), Effect.withParentSpan(parent))),
  ).toBeUndefined()
  expect(
    await Effect.runPromise(
      TraceContext.current.pipe(
        Effect.provideService(References.DisablePropagation, true),
        Effect.withParentSpan(parent),
      ),
    ),
  ).toBeUndefined()
})

test("encodes active W3C baggage and bounds it while using the production OTel tracer", async () => {
  const exported: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      exported.push(await request.json())
      return Response.json({})
    },
  })
  await Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const tracing = yield* Otlp.tracingLayer(
      { endpoint: server.url.origin },
      { client: "test", version: "1.0.0", channel: "local" },
    )
    yield* Effect.gen(function* () {
      const run = Effect.runPromiseWith(yield* Effect.context())
      const baggage = propagation.setBaggage(
        context.active(),
        propagation.createBaggage({
          "tenant.id": { value: "a b,é", metadata: baggageEntryMetadataFromString("property=value") },
        }),
      )
      const carrier = yield* Effect.promise(() =>
        context.with(baggage, () =>
          run(TraceContext.current.pipe(Effect.withSpan("baggage.fixture"), Effect.withParentSpan(parent))),
        ),
      )
      expect(carrier?.tracestate).toBe("vendor=value")
      expect(carrier?.baggage).toBe("tenant.id=a%20b%2C%C3%A9;property=value")

      const oversized = propagation.setBaggage(
        context.active(),
        propagation.createBaggage({
          large: { value: "x".repeat(4096) },
          ...Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`key${index}`, { value: "x" }])),
        }),
      )
      const bounded = yield* Effect.promise(() =>
        context.with(oversized, () => run(TraceContext.current.pipe(Effect.withParentSpan(parent)))),
      )
      expect(bounded?.baggage?.split(",")).toHaveLength(180)
      expect(bounded?.baggage).not.toContain("large=")
      expect(bounded?.baggage?.length).toBeLessThanOrEqual(8192)

      const withoutSpan = yield* Effect.promise(() => context.with(baggage, () => run(TraceContext.current)))
      expect(withoutSpan).toBeUndefined()
    }).pipe(Effect.provide(tracing))
  }).pipe(Effect.scoped, Effect.runPromise)
  // The parent is unsampled, so a valid propagated trace need not be exported locally.
  expect(exported).toHaveLength(0)
})
