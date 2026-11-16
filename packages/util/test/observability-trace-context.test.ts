import { expect, test } from "bun:test"
import { makeExternalSpan } from "@effect/opentelemetry/OtelTracer"
import { Context, Effect, References, Tracer } from "effect"
import { Otlp } from "../src/observability/otlp.js"
import { TraceContext } from "../src/observability/trace-context.js"

test("preserves external trace state and sampled/unsampled flags without a global propagator", async () => {
  for (const traceFlags of [0, 1]) {
    const parent = makeExternalSpan({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags,
      traceState: "vendor=value",
    })
    expect(await Effect.runPromise(TraceContext.current.pipe(Effect.withParentSpan(parent)))).toEqual({
      traceparent: `00-${parent.traceId}-${parent.spanId}-0${traceFlags}`,
      tracestate: "vendor=value",
    })
  }
})

test("omits absent, built-in, invalid, disabled and non-propagating context", async () => {
  const parent = Tracer.externalSpan({ traceId: "1".repeat(32), spanId: "2".repeat(16) })
  expect(await Effect.runPromise(TraceContext.current)).toBeUndefined()
  expect(await Effect.runPromise(TraceContext.current.pipe(Effect.withSpan("MCP.callTool")))).toBeUndefined()
  for (const invalid of ["0".repeat(32), "invalid"]) {
    expect(await Effect.runPromise(TraceContext.current.pipe(
      Effect.withParentSpan(Tracer.externalSpan({ ...parent, traceId: invalid })),
    ))).toBeUndefined()
  }
  expect(await Effect.runPromise(TraceContext.current.pipe(
    Effect.withTracerEnabled(false),
    Effect.withParentSpan(parent),
  ))).toBeUndefined()
  expect(await Effect.runPromise(TraceContext.current.pipe(
    Effect.provideService(References.DisablePropagation, true),
    Effect.withParentSpan(parent),
  ))).toBeUndefined()
  expect(await Effect.runPromise(TraceContext.current.pipe(
    Effect.withParentSpan(Tracer.externalSpan({ ...parent, annotations: Context.make(Tracer.DisablePropagation, true) })),
  ))).toBeUndefined()
})

test("preserves explicitly installed tracing backends that use native spans", async () => {
  const spans: Tracer.Span[] = []
  const carrier = await Effect.runPromise(TraceContext.current.pipe(
    Effect.withSpan("custom-tracing"),
    Effect.provideService(Tracer.Tracer, Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    })),
  ))
  expect(carrier?.traceparent).toBe(`00-${spans[0]?.traceId}-${spans[0]?.spanId}-01`)
})

test("propagates a real production OTel span and exports its parent continuity", async () => {
  const exported: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      exported.push(await request.json())
      return Response.json({})
    },
  })
  const parent = makeExternalSpan({
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    traceFlags: 1,
    traceState: "vendor=value",
  })
  const child = await Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
    const tracing = yield* Otlp.tracingLayer(
      { endpoint: server.url.origin },
      { client: "test", version: "1.0.0", channel: "local" },
    )
    return yield* Effect.gen(function* () {
      const span = yield* Effect.currentSpan
      const carrier = yield* TraceContext.current
      expect(carrier).toEqual({ traceparent: `00-${span.traceId}-${span.spanId}-01`, tracestate: "vendor=value" })
      // A genuine carried OTel parent remains valid even under the receiving fiber's default tracer.
      expect(yield* Effect.promise(() => Effect.runPromise(
        TraceContext.current.pipe(Effect.withParentSpan(span)),
      ))).toEqual(carrier)
      return span.spanId
    }).pipe(Effect.withSpan("trace.fixture"), Effect.withParentSpan(parent), Effect.provide(tracing))
  }).pipe(Effect.scoped, Effect.runPromise)
  expect(exported).toHaveLength(1)
  expect(exported[0]).toMatchObject({
    resourceSpans: [{
      scopeSpans: [{
        spans: [{ name: "trace.fixture", traceId: parent.traceId, spanId: child, parentSpanId: parent.spanId }],
      }],
    }],
  })
})
