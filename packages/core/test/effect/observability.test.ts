import { afterEach, describe, expect, test } from "bun:test"
import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api"
import { injectTraceContext, resource } from "@opencode-ai/core/effect/observability"

const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES
const opencodeClient = process.env.OPENCODE_CLIENT

afterEach(() => {
  if (otelResourceAttributes === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
  else process.env.OTEL_RESOURCE_ATTRIBUTES = otelResourceAttributes

  if (opencodeClient === undefined) delete process.env.OPENCODE_CLIENT
  else process.env.OPENCODE_CLIENT = opencodeClient
})

describe("resource", () => {
  test("parses and decodes OTEL resource attributes", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=anomalyco,team=platform%2Cobservability,label=hello%3Dworld,key%2Fname=value%20here"

    expect(resource().attributes).toMatchObject({
      "service.namespace": "anomalyco",
      team: "platform,observability",
      label: "hello=world",
      "key/name": "value here",
    })
  })

  test("drops OTEL resource attributes when any entry is invalid", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = "service.namespace=anomalyco,broken"

    expect(resource().attributes["service.namespace"]).toBeUndefined()
    expect(resource().attributes["opencode.client"]).toBeDefined()
  })

  test("keeps built-in attributes when env values conflict", () => {
    process.env.OPENCODE_CLIENT = "cli"
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "opencode.client=web,service.instance.id=override,service.namespace=anomalyco"

    expect(resource().attributes).toMatchObject({
      "opencode.client": "cli",
      "service.namespace": "anomalyco",
    })
    expect(resource().attributes["service.instance.id"]).not.toBe("override")
  })
})

describe("injectTraceContext", () => {
  const traceId = "0af7651916cd43dd8448eb211c80319c"
  const spanId = "b7ad6b7169203331"

  const ctxFor = (sc: { traceId: string; spanId: string; traceFlags: number }) =>
    trace.setSpan(ROOT_CONTEXT, trace.wrapSpanContext(sc))

  test("leaves env unchanged when no active span", () => {
    const env = { FOO: "bar" }
    expect(injectTraceContext(env, ROOT_CONTEXT)).toEqual({ FOO: "bar" })
  })

  test("injects TRACEPARENT from the given OTel context", () => {
    const env = injectTraceContext({ FOO: "bar" }, ctxFor({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }))
    expect(env.FOO).toBe("bar")
    expect(env.TRACEPARENT).toBe(`00-${traceId}-${spanId}-01`)
  })

  test("encodes unsampled trace flags as 00", () => {
    expect(injectTraceContext({}, ctxFor({ traceId, spanId, traceFlags: TraceFlags.NONE })).TRACEPARENT).toBe(
      `00-${traceId}-${spanId}-00`,
    )
  })

  test("ignores invalid span contexts", () => {
    expect(
      injectTraceContext({ FOO: "bar" }, ctxFor({ traceId: "0".repeat(32), spanId, traceFlags: 1 })),
    ).toEqual({ FOO: "bar" })
  })

  test("overwrites any stale TRACEPARENT inherited from the env", () => {
    const env = injectTraceContext(
      { TRACEPARENT: "00-stale-stale-00" },
      ctxFor({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }),
    )
    expect(env.TRACEPARENT).toBe(`00-${traceId}-${spanId}-01`)
  })

  test("falls back to the global active context when ctx is omitted", () => {
    // Without a registered context manager, the global active context is ROOT,
    // so injection should be a no-op rather than throw.
    expect(injectTraceContext({ FOO: "bar" })).toEqual({ FOO: "bar" })
    // Sanity: context.with does not propagate without a context manager.
    context.with(ctxFor({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }), () => {
      expect(injectTraceContext({}).TRACEPARENT).toBeUndefined()
    })
  })
})
