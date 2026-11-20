export * as TraceContext from "./trace-context.js"

import { Context, Effect, Option, References, Tracer } from "effect"

/** W3C traceparent/tracestate for the executing caller, without installing global instrumentation or propagators. */
export const current: Effect.Effect<Record<string, string> | undefined> = Effect.gen(function* () {
  if (!(yield* References.TracerEnabled) || (yield* References.DisablePropagation)) return undefined
  const parent = yield* Effect.currentParentSpan.pipe(Effect.option)
  if (Option.isNone(parent) || Context.get(parent.value.annotations, Tracer.DisablePropagation)) return undefined

  // Built-in spans still exist with telemetry off, but the default tracer does not export them.
  if (parent.value instanceof Tracer.NativeSpan && (yield* Effect.tracer) === Tracer.nativeTracer) return undefined

  const [{ trace }, { currentOtelSpan, OtelTraceFlags, OtelTraceState }] = yield* Effect.all([
    Effect.promise(() => import("@opentelemetry/api")),
    Effect.promise(() => import("@effect/opentelemetry/OtelTracer")),
  ])
  const span =
    parent.value._tag === "Span"
      ? (yield* currentOtelSpan.pipe(Effect.orDie)).spanContext()
      : {
          traceId: parent.value.traceId,
          spanId: parent.value.spanId,
          traceFlags:
            Context.getOrUndefined(parent.value.annotations, OtelTraceFlags) ?? (parent.value.sampled ? 1 : 0),
          traceState: Context.getOrUndefined(parent.value.annotations, OtelTraceState),
        }
  if (!trace.isSpanContextValid(span)) return undefined

  // The production Effect NodeSdk layer has no global propagator. Use W3C wire values even then.
  const carrier: Record<string, string> = {
    traceparent: `00-${span.traceId}-${span.spanId}-${span.traceFlags.toString(16).padStart(2, "0")}`,
  }
  const state = span.traceState?.serialize()
  if (state) carrier.tracestate = state
  return carrier
})
