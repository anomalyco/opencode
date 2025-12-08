import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { fn } from "@/util/fn"
import z from "zod"

let tracer: any = null
let initialized = false

export namespace Tracing {
  const log = Log.create({ service: "tracing" })

  export const Config = z
    .object({
      enabled: z.boolean().optional(),
      serviceName: z.string().optional(),
      endpoint: z.string().optional(),
    })
    .optional()

  async function initializeTelemetry() {
    if (initialized || (!process.env.OTEL_SERVICE_NAME && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
      return
    }

    try {
      const { diag, DiagConsoleLogger, DiagLogLevel, trace } = await import("@opentelemetry/api")
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

      const { NodeSDK } = await import("@opentelemetry/sdk-node")
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
      const resourceMod = await import("@opentelemetry/resources")
      const Resource = (resourceMod as any).Resource ?? resourceMod.default
      const { SemanticResourceAttributes } = await import("@opentelemetry/semantic-conventions")
      const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
      const { W3CTraceContextPropagator } = await import("@opentelemetry/core")

      const resourceInstance =
        typeof Resource === "function"
          ? new Resource({
              [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "opencode",
            })
          : undefined

      const sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
        }),
        resource: resourceInstance,
        contextManager: new AsyncLocalStorageContextManager(),
        textMapPropagator: new W3CTraceContextPropagator(),
      })

      sdk.start()
      tracer = trace.getTracer("opencode")
      initialized = true
      log.info("telemetry initialized")
    } catch (err) {
      const { diag } = await import("@opentelemetry/api")
      diag.error("otel init skipped", err)
      log.error("failed to initialize telemetry", { error: err instanceof Error ? err.message : err })
    }
  }

  export const init = fn(Config, async (config) => {
    if (config?.enabled === false) return
    await initializeTelemetry()
  })

  export function startSpan<T>(
    name: string,
    fn: (span: any) => Promise<T>,
    attributes?: Record<string, any>,
  ): Promise<T> {
    if (!tracer) {
      return fn(null)
    }

    return tracer.startActiveSpan(name, async (span: any) => {
      try {
        if (attributes) {
          Object.entries(attributes).forEach(([key, value]) => {
            span.setAttribute(key, value)
          })
        }
        return await fn(span)
      } finally {
        span.end()
      }
    })
  }

  export function setAttributes(attributes: Record<string, any>) {
    if (!tracer) return
    try {
      const api = require("@opentelemetry/api")
      const activeSpan = api.trace.getActiveSpan()
      if (activeSpan) {
        Object.entries(attributes).forEach(([key, value]) => {
          activeSpan.setAttribute(key, value)
        })
      }
    } catch {
      // Ignore if telemetry is not available
    }
  }

  export function addEvent(name: string, attributes?: Record<string, any>) {
    if (!tracer) return
    try {
      const api = require("@opentelemetry/api")
      const activeSpan = api.trace.getActiveSpan()
      if (activeSpan) {
        activeSpan.addEvent(name, attributes)
      }
    } catch {
      // Ignore if telemetry is not available
    }
  }

  export function recordError(error: Error) {
    if (!tracer) return
    try {
      const api = require("@opentelemetry/api")
      const activeSpan = api.trace.getActiveSpan()
      if (activeSpan) {
        activeSpan.recordException(error)
      }
    } catch {
      // Ignore if telemetry is not available
    }
  }

  export const wrap = <T extends (...args: any[]) => any>(name: string, fn: T, attributes?: Record<string, any>): T => {
    return (async (...args: any[]) => {
      return startSpan(name, async (span) => {
        if (attributes) {
          setAttributes({ ...attributes, args: args.length })
        }
        try {
          const result = await fn(...args)
          if (span) {
            span.setStatus({ code: 1 })
          }
          return result
        } catch (error) {
          if (error instanceof Error) {
            recordError(error)
          }
          if (span) {
            span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      })
    }) as T
  }

  export const state = Instance.state(async () => {
    return { initialized }
  })
}
