import { Layer } from "effect"
import { OtlpLogger } from "effect/unstable/observability"
import { InstallationChannel, InstallationVersion } from "../installation/version"
import { runID } from "./shared"

export interface Options {
  readonly endpoint?: string
  readonly headers?: string
  readonly client?: string
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

export function resource(client = "cli"): { serviceName: string; serviceVersion: string; attributes: Record<string, string> } {
  return {
    serviceName: "opencode",
    serviceVersion: InstallationVersion,
    attributes: {
      ...resourceAttributes(),
      "deployment.environment.name": InstallationChannel,
      "opencode.client": client,
      "opencode.run": runID,
      "service.instance.id": runID,
    },
  }
}

export function loggers(options?: Options) {
  if (!options?.endpoint) return []
  return [
    OtlpLogger.make({
      url: `${options.endpoint}/v1/logs`,
      resource: resource(options.client),
      headers: parseHeaders(options.headers),
    }),
  ]
}

export async function tracingLayer(options?: Options) {
  if (!options?.endpoint) return Layer.empty
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")
  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const { context } = await import("@opentelemetry/api")

  // The Effect Node SDK does not register a global context manager, but the AI SDK uses it to parent spans.
  const manager = new AsyncLocalStorageContextManager()
  manager.enable()
  context.setGlobalContextManager(manager)

  return NodeSdk.layer(() => ({
    resource: resource(options.client),
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${options.endpoint}/v1/traces`,
        headers: parseHeaders(options.headers),
      }),
    ),
  }))
}

export * as Otlp from "./otlp"
