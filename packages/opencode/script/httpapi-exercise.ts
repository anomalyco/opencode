delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
delete process.env["OTEL_EXPORTER_OTLP_HEADERS"]

await import("../test/server/httpapi-exercise/index")
