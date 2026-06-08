import { Effect, Layer, Logger, References, type LogLevel } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import path from "path"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import { InstallationChannel, InstallationVersion } from "../installation/version"

const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
export const enabled = !!base
const runID = crypto.randomUUID()
const printLogs = "OPENCODE_PRINT_LOGS"
const logLevel = "OPENCODE_LOG_LEVEL"

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, x) => {
        const [key, ...value] = x.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

export function resource(): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  const attributes: Record<string, string> = (() => {
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
  })()

  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...attributes,
      "deployment.environment.name": InstallationChannel,
      "opencode.client": Flag.OPENCODE_CLIENT,
      "opencode.run_id": runID,
      "service.instance.id": runID,
    },
  }
}

function formatter(id: string = runID) {
  return Logger.map(Logger.formatLogFmt, (output) =>
    output.replace(/ level=([^ ]+)/, (_, level: string) => ` level=${level.toUpperCase()} run_id=${id}`),
  )
}

export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  return Logger.toFile(formatter(id), file, { flag: "a", batchWindow: 0 })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

function minimumLogLevel() {
  const value = process.env[logLevel]?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  return value && value in levels ? levels[value as keyof typeof levels] : levels.INFO
}

function local() {
  const logger = Logger.layer(
    process.env[printLogs] === "1" ? [fileLogger(), stderrLogger] : [fileLogger()],
    { mergeWithExisting: false },
  ).pipe(Layer.provide(NodeFileSystem.layer), Layer.orDie)
  return Layer.merge(logger, Layer.succeed(References.MinimumLogLevel, minimumLogLevel()))
}

function logs() {
  return Logger.layer(
    [
      fileLogger(),
      ...(process.env[printLogs] === "1" ? [stderrLogger] : []),
      OtlpLogger.make({
        url: `${base}/v1/logs`,
        resource: resource(),
        headers,
      }),
    ],
    { mergeWithExisting: false },
  ).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
    Layer.orDie,
    Layer.merge(Layer.succeed(References.MinimumLogLevel, minimumLogLevel())),
  )
}

const traces = async () => {
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")

  // @effect/opentelemetry creates a NodeTracerProvider but never calls
  // register(), so the global @opentelemetry/api context manager stays
  // as the no-op default. Non-Effect code (like the AI SDK) that calls
  // tracer.startActiveSpan() relies on context.active() to find the
  // parent span - without a real context manager every span starts a
  // new trace. Registering AsyncLocalStorageContextManager fixes this.
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")
  const mgr = new AsyncLocalStorageContextManager()
  mgr.enable()
  context.setGlobalContextManager(mgr)

  return NodeSdk.layer(() => ({
    resource: resource(),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${base}/v1/traces`,
        headers,
      }),
    ),
  }))
}

export const layer = Layer.unwrap(
  Effect.sync(() =>
    !base
      ? local()
      : Layer.unwrap(
          Effect.gen(function* () {
            const trace = yield* Effect.promise(traces)
            return Layer.mergeAll(trace, logs())
          }),
        ),
  ),
)

export const Observability = { enabled, layer }
