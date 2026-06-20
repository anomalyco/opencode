import { Layer } from "effect"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { runID } from "./shared"

const endpoint = Flag.OTEL_EXPORTER_OTLP_ENDPOINT

export type OtlpProtocol = "http/json" | "http/protobuf"
export type OtlpSignal = "logs" | "traces"

const defaultProtocol: OtlpProtocol = "http/json"

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, entry) => {
        const [key, ...value] = entry.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

function protocolValue(signal: OtlpSignal) {
  return (
    (signal === "logs" ? Flag.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL : Flag.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL) ??
    Flag.OTEL_EXPORTER_OTLP_PROTOCOL
  )
}

export function protocol(signal: OtlpSignal): OtlpProtocol {
  const value = protocolValue(signal)
  if (value === "http/json") return value
  if (value === "http/protobuf") return value
  return defaultProtocol
}

export function serializationLayer() {
  return protocol("logs") === "http/protobuf" ? OtlpSerialization.layerProtobuf : OtlpSerialization.layerJson
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

export function resource(): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": InstallationChannel,
      "opencode.client": Flag.OPENCODE_CLIENT,
      "opencode.run": runID,
      "service.instance.id": runID,
    },
  }
}

export function loggers() {
  if (!endpoint) return []
  return [OtlpLogger.make({ url: `${endpoint}/v1/logs`, resource: resource(), headers })]
}

export async function tracingLayer() {
  if (!endpoint) return Layer.empty
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP =
    protocol("traces") === "http/protobuf"
      ? await import("@opentelemetry/exporter-trace-otlp-proto")
      : await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")

  // The Effect Node SDK does not register a global context manager, but the AI SDK uses it to parent spans.
  const manager = new AsyncLocalStorageContextManager()
  manager.enable()
  context.setGlobalContextManager(manager)

  return NodeSdk.layer(() => ({
    resource: resource(),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
        headers,
      }),
    ),
  }))
}

export * as Otlp from "./otlp"
