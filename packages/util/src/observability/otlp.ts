import { Effect, Layer, Scope } from "effect"
import { OtlpLogger } from "effect/unstable/observability"
import { runID } from "./shared.js"

export interface Options {
  readonly endpoint?: string
  readonly headers?: string
}

export interface App {
  readonly client: string
  readonly version: string
  readonly channel: string
}

function parseHeaders(value?: string) {
  return value
    ? value.split(",").reduce(
        (acc, entry) => {
          const [key, ...value] = entry.split("=")
          acc[key] = value.join("=")
          return acc
        },
        {} as Record<string, string>,
      )
    : undefined
}

function resourceAttributes() {
  const value = process.env.OTEL_RESOURCE_ATTRIBUTES
  if (!value) return {}
  try {
    return Object.fromEntries(
      value.split(",").map((entry) => {
        const index = entry.indexOf("=")
        if (index < 1) throw new Error("Invalid OTEL_RESOURCE_ATTRIBUTES entry")
        return [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))]
      }),
    )
  } catch {
    return {}
  }
}

export function resource(app: App = { client: "opencode", version: "unknown", channel: "local" }): {
  serviceName: string
  serviceVersion: string
  attributes: Record<string, string>
} {
  return {
    serviceName: "opencode",
    serviceVersion: app.version,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": app.channel,
      "opencode.client": app.client,
      "opencode.run": runID,
      "service.instance.id": runID,
    },
  }
}

export function loggers(options: Options | undefined, app: App) {
  if (!options?.endpoint) return []
  return [
    OtlpLogger.make({
      url: `${options.endpoint}/v1/logs`,
      resource: resource(app),
      headers: parseHeaders(options.headers),
    }),
  ]
}

export const tracingLayer = Effect.fnUntraced(function* (options: Options | undefined, app: App) {
  if (!options?.endpoint) return Layer.empty
  const [{ layer }, { OTLPTraceExporter }, { BatchSpanProcessor }, { AsyncLocalStorageContextManager }, { context }] =
    yield* Effect.all(
      [
        Effect.promise(() => import("@effect/opentelemetry/NodeSdk")),
        Effect.promise(() => import("@opentelemetry/exporter-trace-otlp-http")),
        Effect.promise(() => import("@opentelemetry/sdk-trace-base")),
        Effect.promise(() => import("@opentelemetry/context-async-hooks")),
        Effect.promise(() => import("@opentelemetry/api")),
      ],
      { concurrency: "unbounded" },
    )

  // The Effect Node SDK does not register a global context manager, but the AI SDK uses it to parent spans.
  const manager = new AsyncLocalStorageContextManager()
  manager.enable()
  context.setGlobalContextManager(manager)

  const tracing = layer(() => ({
    resource: resource(app),
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${options.endpoint}/v1/traces`,
        headers: parseHeaders(options.headers),
      }),
    ),
  }))
  return Layer.effectContext(
    Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit).pipe(Effect.ignoreCause)).pipe(
      Effect.flatMap((scope) => Layer.buildWithScope(tracing, scope)),
    ),
  )
})

export * as Otlp from "./otlp.js"
