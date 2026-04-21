import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import * as EffectLogger from "./logger"
import { Flag } from "@/flag/flag"
import { InstallationChannel, InstallationVersion } from "@/installation/version"
import { ensureProcessMetadata } from "@/util/opencode-process"

const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
export const enabled = !!base
const processID = crypto.randomUUID()

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
  const processMetadata = ensureProcessMetadata("main")
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
      "opencode.process_role": processMetadata.processRole,
      "opencode.run_id": processMetadata.runID,
      "service.instance.id": processID,
    },
  }
}

function logs() {
  return Logger.layer(
    [
      EffectLogger.logger,
      OtlpLogger.make({
        url: `${base}/v1/logs`,
        resource: resource(),
        headers,
      }),
    ],
    { mergeWithExisting: false },
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))
}

const traces = async () => {
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")

  // @effect/opentelemetry creates a NodeTracerProvider but never calls
  // register(), so the global @opentelemetry/api context manager stays
  // as the no-op default. Non-Effect code (like the AI SDK) that calls
  // tracer.startActiveSpan() relies on context.active() to find the
  // parent span — without a real context manager every span starts a
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

export const layer = !base
  ? EffectLogger.layer
  : Layer.unwrap(
      Effect.gen(function* () {
        const trace = yield* Effect.promise(traces)
        return Layer.mergeAll(trace, logs())
      }),
    )

export const Observability = { enabled, layer }
