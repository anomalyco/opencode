import { Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Otlp } from "effect/unstable/observability"
import { Flag } from "@/flag/flag"
import { CHANNEL, VERSION } from "@/installation/meta"

export namespace Observability {
  export const enabled = !!Flag.OTEL_EXPORTER_OTLP_ENDPOINT

  export const layer = !Flag.OTEL_EXPORTER_OTLP_ENDPOINT
    ? Layer.empty
    : Otlp.layerJson({
        baseUrl: Flag.OTEL_EXPORTER_OTLP_ENDPOINT,
        loggerMergeWithExisting: false,
        resource: {
          serviceName: "opencode",
          serviceVersion: VERSION,
          attributes: {
            "deployment.environment.name": CHANNEL === "local" ? "local" : CHANNEL,
            "opencode.client": Flag.OPENCODE_CLIENT,
          },
        },
        headers: Flag.OTEL_EXPORTER_OTLP_HEADERS
          ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
              (acc, x) => {
                const [key, value] = x.split("=")
                acc[key] = value
                return acc
              },
              {} as Record<string, string>,
            )
          : undefined,
      }).pipe(Layer.provide(FetchHttpClient.layer))
}
