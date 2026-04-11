import { Duration, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Otlp } from "effect/unstable/observability"
import { EffectLogger } from "@/effect/logger"
import { Flag } from "@/flag/flag"
import { CHANNEL, VERSION } from "@/installation/meta"

export namespace Observability {
  const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
  export const enabled = !!base

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
    ? EffectLogger.layer
    : Otlp.layerJson({
        baseUrl: base,
        loggerExportInterval: Duration.seconds(1),
        loggerMergeWithExisting: true,
        resource,
        headers,
      }).pipe(Layer.provide(EffectLogger.layer), Layer.provide(FetchHttpClient.layer))
}
