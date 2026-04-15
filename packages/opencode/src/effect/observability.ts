import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import { EffectLogger } from "@/effect/logger"
import { Flag } from "@/flag/flag"
import { CHANNEL, VERSION } from "@/installation/meta"

export namespace Observability {
  const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
  export const enabled = !!base

  const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
    ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
        (acc, x) => {
          const [key, value] = x.split("=")
          acc[key] = value
          return acc
        },
        {} as Record<string, string>,
      )
    : undefined

  const resource = {
    serviceName: "opencode",
    serviceVersion: VERSION,
    attributes: {
      "deployment.environment.name": CHANNEL === "local" ? "local" : CHANNEL,
      "opencode.client": Flag.OPENCODE_CLIENT,
    },
  }

  const logs = Logger.layer(
    [
      EffectLogger.logger,
      OtlpLogger.make({
        url: `${base}/v1/logs`,
        resource,
        headers,
      }),
    ],
    { mergeWithExisting: false },
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))

  const traces = async () => {
    const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
    const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
    const SdkBase = await import("@opentelemetry/sdk-trace-base")

    return NodeSdk.layer(() => ({
      resource,
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
          return Layer.mergeAll(trace, logs)
        }),
      )
}
