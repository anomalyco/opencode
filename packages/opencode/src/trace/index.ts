import { NodeSDK } from "@opentelemetry/sdk-node"
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"

export namespace Trace {
  export function init() {
    const sdk = new NodeSDK({
      serviceName: "opencode",
      instrumentations: [new FetchInstrumentation()],
      traceExporter: new OTLPTraceExporter({
        url: "http://localhost:4318/v1/traces", // or your OTLP endpoint
      }),
    })

    sdk.start()
  }
}
