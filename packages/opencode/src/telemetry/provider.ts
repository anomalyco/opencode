import { NodeSDK } from "@opentelemetry/sdk-node"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { trace } from "@opentelemetry/api"
import type { Tracer } from "@opentelemetry/api"
import { TelemetryConfig } from "./config"
import { Log } from "@/util/log"
import { Installation } from "@/installation"

export namespace TelemetryProvider {
  let sdk: NodeSDK | undefined
  let spanProcessor: SpanProcessor | undefined
  let initialized = false
  let config: TelemetryConfig.ObjectInfo | undefined

  export async function init(cfg: boolean | TelemetryConfig.ObjectInfo | undefined): Promise<void> {
    if (initialized) return

    const normalized = TelemetryConfig.normalize(cfg)
    const envConfig = TelemetryConfig.fromEnv()
    config = TelemetryConfig.merge(normalized, envConfig)

    if (!config.enabled) {
      Log.Default.debug("telemetry disabled")
      return
    }

    const baseEndpoint = config.endpoint ?? "http://localhost:4318"
    const endpoint = baseEndpoint.endsWith("/v1/traces") ? baseEndpoint : `${baseEndpoint.replace(/\/$/, "")}/v1/traces`

    Log.Default.info("initializing telemetry", {
      endpoint,
      serviceName: config.serviceName,
      sampleRate: config.sampleRate,
    })

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: Installation.VERSION,
      ...config.attributes,
    })

    const exporter = new OTLPTraceExporter({
      url: endpoint,
      headers: config.headers,
    })

    spanProcessor = new BatchSpanProcessor(exporter, {
      maxQueueSize: config.maxQueueSize,
      scheduledDelayMillis: config.exportInterval,
    })

    sdk = new NodeSDK({
      resource,
      traceExporter: exporter,
      spanProcessors: [spanProcessor],
    })

    sdk.start()
    initialized = true

    Log.Default.info("telemetry initialized", { endpoint })
  }

  export async function shutdown(): Promise<void> {
    if (!initialized || !sdk) return

    Log.Default.info("shutting down telemetry")

    await spanProcessor?.forceFlush().catch(() => {})
    await sdk.shutdown().catch(() => {})

    initialized = false
    sdk = undefined
    spanProcessor = undefined
    config = undefined

    Log.Default.info("telemetry shutdown complete")
  }

  export function getTracer(name = "opencode"): Tracer | undefined {
    if (!initialized || !config?.enabled) return undefined
    return trace.getTracer(name, Installation.VERSION)
  }

  export function isEnabled(): boolean {
    return initialized && (config?.enabled ?? false)
  }

  export function getConfig(): TelemetryConfig.ObjectInfo | undefined {
    return config
  }
}
