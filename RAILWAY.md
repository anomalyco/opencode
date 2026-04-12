# OpenCode Veritly on Railway

Build and run from [`Dockerfile`](Dockerfile) in this directory (`vendor/opencode-veritly`). Set **`OPENCODE_SERVER_PASSWORD`** and any required **`VITE_*`** build args in Railway.

**PostHog (product analytics):** set Docker build args **`VITE_PUBLIC_POSTHOG_KEY`** (project API key, `phc_…`) and optionally **`VITE_PUBLIC_POSTHOG_HOST`**. If the host is omitted, the app defaults to **`https://eu.i.posthog.com`** (override with `https://us.i.posthog.com` for US projects). The app initializes `posthog-js` only when the key is present.

**OpenTelemetry → PostHog traces:** set runtime env on the same service (and on **`veritly-usip`** if you run it separately):

- **`OTEL_EXPORTER_OTLP_ENDPOINT`**: base ingest host for your project region, e.g. **`https://eu.i.posthog.com`** or **`https://us.i.posthog.com`** (traces path `/i/v1/traces` is appended automatically if you do not set the traces endpoint).
- **`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`** (optional): full OTLP HTTP URL for traces, e.g. `https://eu.i.posthog.com/i/v1/traces`.
- **`OTEL_EXPORTER_OTLP_HEADERS`**: comma-separated `key=value` pairs. PostHog expects **`Authorization=Bearer <phc_…>`** (same project token as analytics).
- **`DEPLOYMENT_ENVIRONMENT`**: e.g. `production` or `staging` (sets `deployment.environment` on spans).

If OTLP env is omitted, servers still run; no traces are exported.

**Production visibility:** use **`railway logs`**, a log drain, or structured logging you add in app code. Remote Bun inspectors, Tailscale debug hooks, and IDE attach configs were removed from this repo path in favor of logs.
