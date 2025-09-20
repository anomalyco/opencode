import {
  type TelemetrySettings
} from "ai"

const useOtel = process.env["USE_OTEL"]

export const aiSdkTelemetrySettings: TelemetrySettings | undefined = !useOtel ? undefined : {
  isEnabled: true,
}

export function initOpenTelemetry() {
  // OpenTelemetry is optional. Load Node SDK dynamically only when requested
  // to avoid importing Node-only packages in Bun or other runtimes.
  if (useOtel) {
    ;(async () => {
      try {
        const { NodeSDK } = await import("@opentelemetry/sdk-node")
        const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc")

        // see https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/#otel_exporter_otlp_protocol
        const needsDefaultProtocol = !process.env["OTEL_EXPORTER_OTLP_PROTOCOL"]
        const otelNodeSdk = new NodeSDK({
            traceExporter: !needsDefaultProtocol ? undefined : new OTLPTraceExporter({}),
        });

        await otelNodeSdk.start()
        process.on("exit", () => {
          otelNodeSdk.shutdown()
        })
      } catch (err) {
        // Avoid crashing the CLI when OTEL initialization fails; warn instead.
        // Logging isn't initialized yet so write to stderr.
        console.warn("failed to initialize OpenTelemetry:", err instanceof Error ? err.message : err)
      }
    })()
  }
}

