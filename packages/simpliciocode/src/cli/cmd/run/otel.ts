import { INVALID_SPAN_CONTEXT, context, trace, SpanStatusCode, type Span } from "@opentelemetry/api"
import { Effect, ManagedRuntime } from "effect"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { Observability } from "@opencode-ai/core/effect/observability"

type AttributeValue = string | number | boolean | undefined

export type RunSpanAttributes = Record<string, AttributeValue>

const noop = trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
const tracer = trace.getTracer("opencode.run")
const runtime = ManagedRuntime.make(Observability.layer, { memoMap })
let ready: Promise<void> | undefined

function attributes(input?: RunSpanAttributes): Record<string, string | number | boolean> | undefined {
  if (!input) {
    return undefined
  }

  const out = Object.entries(input).flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const]))
  if (out.length === 0) {
    return undefined
  }

  return Object.fromEntries(out)
}

function message(error: unknown) {
  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error) {
    return error.message || error.name
  }

  return String(error)
}

function ensure() {
  if (!Observability.enabled) {
    return Promise.resolve()
  }

  if (ready) {
    return ready
  }

  ready = runtime.runPromise(Effect.void).then(
    () => undefined,
    (error) => {
      ready = undefined
      throw error
    },
  )
  return ready
}

function finish<A>(span: Span, out: Promise<A>) {
  return out.then(
    (value) => {
      span.end()
      return value
    },
    (error) => {
      recordRunSpanError(span, error)
      span.end()
      throw error
    },
  )
}

export function setRunSpanAttributes(span: Span, input?: RunSpanAttributes): void {
  const next = attributes(input)
  if (!next) {
    return
  }

  span.setAttributes(next)
}

export function recordRunSpanError(span: Span, error: unknown): void {
  const next = message(error)
  span.recordException(error instanceof Error ? error : next)
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: next,
  })
}

export function withRunSpan<A>(
  name: string,
  input: RunSpanAttributes | undefined,
  fn: (span: Span) => Promise<A> | A,
): A | Promise<A> {
  if (!Observability.enabled) {
    return fn(noop)
  }

  return ensure().then(
    () => {
      const span = tracer.startSpan(name, {
        attributes: attributes(input),
      })

      return context.with(trace.setSpan(context.active(), span), () =>
        finish(
          span,
          new Promise<A>((resolve) => {
            resolve(fn(span))
          }),
        ),
      )
    },
    () => fn(noop),
  )
}
