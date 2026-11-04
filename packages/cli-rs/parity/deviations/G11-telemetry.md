# G11: OpenTelemetry and log files

TypeScript: with `OTEL_EXPORTER_OTLP_ENDPOINT` set, the CLI exports logs to `/v1/logs` and traces (Effect spans,
the AI SDK's spans) to `/v1/traces`. Log records go to the shared file in `<data>/log` in batches written about
once a second.

Rust:

- Logs only. The client has no spans to export, so nothing goes to `/v1/traces`.
- The exporter posts once per batch with no retry of transient failures. A failed post drops records for 60 s, as
  Effect's exporter does after its retries.
- Each record is appended to the log file at once, one write per line, instead of in batches.
- Debug and trace records of third-party crates (HTTP, TLS) are left out at every level; the client's own crates
  follow `--log-level`.
- The "cli starting" record also has `client=<OPENCODE_CLIENT or opencode-rs>`, because TS and Rust records share
  one file.
- Panics are logged to the same file (`message="panic …" thread=… backtrace=…`), not to a separate file.

Reason: the Rust client produces no spans, and the remaining differences are not visible to users. The extra
field tells the two clients' records apart in the shared file.
