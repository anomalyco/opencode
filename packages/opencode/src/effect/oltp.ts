import { Duration, Logger, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/unstable/observability"
import { EffectLogger } from "@/effect/logger"
import { Flag } from "@/flag/flag"
import { CHANNEL, VERSION } from "@/installation/meta"

export namespace Observability {
  export const enabled = !!Flag.OTEL_EXPORTER_OTLP_ENDPOINT

  const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT

  const resource = {
    serviceName: "opencode",
    serviceVersion: VERSION,
    attributes: {
      "deployment.environment.name": CHANNEL === "local" ? "local" : CHANNEL,
      "opencode.client": Flag.OPENCODE_CLIENT,
    },
  }

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

  export const layer = !base
    ? Layer.empty
    : (() => {
        const url = (path: string) => new URL(path, base).toString()
        return Layer.mergeAll(
          Logger.layer([
            EffectLogger.logger,
            OtlpLogger.make({
              url: url("/v1/logs"),
              exportInterval: Duration.seconds(5),
              headers,
              resource,
            }),
          ]),
          OtlpMetrics.layer({
            url: url("/v1/metrics"),
            headers,
            resource,
          }),
          OtlpTracer.layer({
            url: url("/v1/traces"),
            headers,
            resource,
          }),
        ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))
      })()
}
