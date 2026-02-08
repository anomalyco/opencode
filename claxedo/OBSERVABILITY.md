# Claxedo Observability

This document provides comprehensive documentation for the Claxedo backend observability system, covering distributed tracing, metrics collection, and error tracking.

## Table of Contents

1. [Overview](#1-overview)
2. [Configuration](#2-configuration)
3. [OpenTelemetry Tracing](#3-opentelemetry-tracing)
4. [Prometheus Metrics](#4-prometheus-metrics)
5. [Sentry Error Tracking](#5-sentry-error-tracking)
6. [Integration Guide](#6-integration-guide)
7. [Dashboards & Alerts](#7-dashboards--alerts)

---

## 1. Overview

### 1.1 Observability Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claxedo Gateway Server                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  OpenTelemetry  │  │   Prometheus    │  │     Sentry      │  │
│  │    Tracing      │  │    Metrics      │  │  Error Tracking │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
    │ OTEL Collector│    │  Prometheus   │    │    Sentry     │
    │   (Jaeger,    │    │    Server     │    │    Cloud      │
    │    Tempo)     │    │               │    │               │
    └───────────────┘    └───────────────┘    └───────────────┘
```

### 1.2 Key Features

| Feature | Technology | Purpose |
|---------|------------|---------|
| **Distributed Tracing** | OpenTelemetry | Request flow across services |
| **Metrics** | Prometheus | Performance & business metrics |
| **Error Tracking** | Sentry | Exception capture & alerting |
| **Log Correlation** | All | Link logs to traces |

---

## 2. Configuration

### 2.1 Environment Variables

```bash
# ═══════════════════════════════════════════════════════
# OpenTelemetry Configuration
# ═══════════════════════════════════════════════════════

OTEL_ENABLED=true
# Enable/disable OpenTelemetry tracing

OTEL_SERVICE_NAME=claxedo-gateway
# Service name in traces

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
# OTLP HTTP endpoint (Jaeger, Tempo, etc.)

OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer token
# Optional headers for authenticated endpoints

OTEL_TRACE_SAMPLE_RATE=0.1
# Sampling rate: 0.0 to 1.0 (production: 0.1, dev: 1.0)

# ═══════════════════════════════════════════════════════
# Prometheus Configuration
# ═══════════════════════════════════════════════════════

PROMETHEUS_ENABLED=true
# Enable/disable Prometheus metrics endpoint

PROMETHEUS_PATH=/metrics
# Path for metrics endpoint

# ═══════════════════════════════════════════════════════
# Sentry Configuration
# ═══════════════════════════════════════════════════════

SENTRY_ENABLED=true
# Enable/disable Sentry error tracking

SENTRY_DSN=https://xxx@sentry.io/123
# Sentry Data Source Name

SENTRY_TRACES_SAMPLE_RATE=0.1
# Sentry performance monitoring sample rate

SENTRY_ENVIRONMENT=production
# Environment tag (production, staging, development)
```

### 2.2 Configuration Object

```typescript
interface ObservabilityConfig {
  // OpenTelemetry
  otelEnabled: boolean
  otelServiceName: string
  otelExporterEndpoint: string
  otelExporterHeaders: Record<string, string>
  otelTraceSampleRate: number

  // Prometheus
  prometheusEnabled: boolean
  prometheusPath: string

  // Sentry
  sentryEnabled: boolean
  sentryDsn: string
  sentryTracesSampleRate: number
  sentryEnvironment: string
}
```

---

## 3. OpenTelemetry Tracing

### 3.1 Initialization

```typescript
import { initTracing, shutdownTracing } from "./observability"

// On startup
initTracing()

// On shutdown
await shutdownTracing()
```

### 3.2 Automatic Instrumentation

The tracing middleware automatically creates spans for:

- All HTTP requests (method, route, status)
- Database queries (Convex operations)
- External API calls (Daytona, Clerk)

### 3.3 Manual Span Creation

```typescript
import { withSpan, startSpan, SpanKind } from "./observability"

// Async function wrapper
const result = await withSpan("operation.name", async (span) => {
  span.setAttribute("custom.attribute", "value")
  return await doWork()
})

// Manual span management
const span = startSpan("manual.operation", {
  kind: SpanKind.INTERNAL,
  attributes: { "workspace.id": workspaceId }
})
try {
  await doWork()
  span.setStatus({ code: SpanStatusCode.OK })
} catch (error) {
  span.recordException(error)
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
  throw error
} finally {
  span.end()
}
```

### 3.4 Trace Context Propagation

**HTTP Headers:**
```typescript
import { injectTraceContext, extractTraceContext } from "./observability"

// Inject into outgoing request
const headers = injectTraceContext({})
// Result: { traceparent: "00-{traceId}-{spanId}-01" }

// Extract from incoming request
const context = extractTraceContext(request.headers)
```

**WebSocket Messages:**
```typescript
import { encodeTraceContextForWs, decodeTraceContextFromWs } from "./observability"

// Encode for WS message
const encoded = encodeTraceContextForWs()

// Decode from WS message
const context = decodeTraceContextFromWs(encoded)
```

### 3.5 Key Spans

| Span Name | Attributes | Description |
|-----------|------------|-------------|
| `gateway.proxy.directory.resolve` | workspace.id, sandbox.id, sandbox.url | Directory resolution |
| `gateway.proxy.directory.fetch` | http.url, http.method, http.status_code | Proxy request |
| `gateway.proxy.workspace.resolve` | workspace.id, sandbox.id | Workspace resolution |
| `gateway.proxy.workspace.fetch` | http.url, http.method, http.status_code | Proxy request |
| `sandbox.ensure_running` | sandbox.from_snapshot, sandbox.org_id, status | Sandbox startup |
| `sandbox.repo.clone` | repo.url, repo.dir | Repository cloning |
| `opencode.server.start` | opencode.port, opencode.cwd | OpenCode server startup |
| `opencode.credentials.inject` | credentials.count | Credential injection |
| `convex.query.*` | operation, status | Convex database operations |
| `daytona.api.*` | operation, status | Daytona API calls |

---

## 4. Prometheus Metrics

### 4.1 Endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4
```

### 4.2 HTTP Metrics

```prometheus
# HELP http_request_duration_seconds HTTP request latency in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/global/health",status="200",le="0.005"} 100
http_request_duration_seconds_bucket{method="GET",route="/global/health",status="200",le="0.01"} 150
...

# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/global/health",status="200"} 1234
http_requests_total{method="POST",route="/api/workspace/create",status="201"} 56
```

### 4.3 Sandbox Metrics

```prometheus
# HELP sandbox_creation_duration_seconds Time to create a sandbox
# TYPE sandbox_creation_duration_seconds histogram
sandbox_creation_duration_seconds_bucket{org_id="org-123",from_snapshot="true",status="success",le="10"} 5
sandbox_creation_duration_seconds_bucket{org_id="org-123",from_snapshot="true",status="success",le="30"} 8
...

# HELP sandbox_creations_total Total number of sandbox creations
# TYPE sandbox_creations_total counter
sandbox_creations_total{org_id="org-123",from_snapshot="true",status="success"} 42
sandbox_creations_total{org_id="org-123",from_snapshot="false",status="error"} 3

# HELP active_sandboxes Number of currently active sandboxes
# TYPE active_sandboxes gauge
active_sandboxes{org_id="org-123",status="running"} 5
active_sandboxes{org_id="org-456",status="running"} 2
```

### 4.4 Workspace Metrics

```prometheus
# HELP workspace_creation_duration_seconds End-to-end workspace creation time
# TYPE workspace_creation_duration_seconds histogram
workspace_creation_duration_seconds_bucket{org_id="org-123",has_repo="true",status="success",le="60"} 10
...

# HELP workspace_wake_duration_seconds Time to wake a sleeping workspace
# TYPE workspace_wake_duration_seconds histogram
workspace_wake_duration_seconds_bucket{org_id="org-123",status="success",le="5"} 20
...

# HELP workspace_deletion_duration_seconds Time to delete a workspace
# TYPE workspace_deletion_duration_seconds histogram
workspace_deletion_duration_seconds_bucket{org_id="org-123",status="success",le="1"} 15
```

### 4.5 Session & PTY Metrics

```prometheus
# HELP session_creation_duration_seconds Time to create a session
# TYPE session_creation_duration_seconds histogram
session_creation_duration_seconds_bucket{workspace_id="ws-123",status="success",le="0.1"} 100

# HELP active_sessions Number of currently active sessions
# TYPE active_sessions gauge
active_sessions{workspace_id="ws-123"} 3

# HELP pty_creation_duration_seconds Time to spawn a PTY
# TYPE pty_creation_duration_seconds histogram
pty_creation_duration_seconds_bucket{workspace_id="ws-123",status="success",le="0.5"} 50

# HELP pty_first_byte_duration_seconds Time to first output byte from PTY
# TYPE pty_first_byte_duration_seconds histogram
pty_first_byte_duration_seconds_bucket{workspace_id="ws-123",le="0.1"} 45
```

### 4.6 WebSocket Metrics

```prometheus
# HELP websocket_connections_active Number of active WebSocket connections
# TYPE websocket_connections_active gauge
websocket_connections_active{type="pty"} 12
websocket_connections_active{type="event"} 5

# HELP websocket_messages_total Total number of WebSocket messages
# TYPE websocket_messages_total counter
websocket_messages_total{type="pty",direction="in"} 50000
websocket_messages_total{type="pty",direction="out"} 75000

# HELP websocket_message_latency_seconds WebSocket message round-trip latency
# TYPE websocket_message_latency_seconds histogram
websocket_message_latency_seconds_bucket{type="pty",le="0.01"} 40000

# HELP websocket_connection_duration_seconds WebSocket connection lifetime
# TYPE websocket_connection_duration_seconds histogram
websocket_connection_duration_seconds_bucket{type="pty",close_reason="normal",le="300"} 100
```

### 4.7 External API Metrics

```prometheus
# HELP daytona_api_duration_seconds Daytona API call latency
# TYPE daytona_api_duration_seconds histogram
daytona_api_duration_seconds_bucket{operation="create",status="success",le="30"} 20
daytona_api_duration_seconds_bucket{operation="start",status="success",le="10"} 50
daytona_api_duration_seconds_bucket{operation="get",status="success",le="1"} 200

# HELP convex_query_duration_seconds Convex query/mutation latency
# TYPE convex_query_duration_seconds histogram
convex_query_duration_seconds_bucket{operation="workspaces.getById",status="success",le="0.1"} 500
convex_query_duration_seconds_bucket{operation="projects.create",status="success",le="0.5"} 30
```

### 4.8 Proxy Metrics

```prometheus
# HELP proxy_request_duration_seconds Time to proxy request to upstream
# TYPE proxy_request_duration_seconds histogram
proxy_request_duration_seconds_bucket{proxy_type="directory",status="200",le="0.5"} 1000
proxy_request_duration_seconds_bucket{proxy_type="workspace",status="200",le="0.5"} 500

# HELP proxy_resolution_duration_seconds Time to resolve upstream URL
# TYPE proxy_resolution_duration_seconds histogram
proxy_resolution_duration_seconds_bucket{proxy_type="directory",cache_hit="true",le="0.01"} 800
proxy_resolution_duration_seconds_bucket{proxy_type="directory",cache_hit="false",le="0.5"} 200
```

### 4.9 Credential Metrics

```prometheus
# HELP credential_sync_duration_seconds Time to sync credentials to sandbox
# TYPE credential_sync_duration_seconds histogram
credential_sync_duration_seconds_bucket{org_id="org-123",status="success",le="0.5"} 100

# HELP credential_sync_total Total credential sync operations
# TYPE credential_sync_total counter
credential_sync_total{org_id="org-123",provider="openai",status="success"} 50
credential_sync_total{org_id="org-123",provider="anthropic",status="success"} 45
```

### 4.10 Using Metrics in Code

```typescript
import {
  httpRequestDuration,
  httpRequestsTotal,
  sandboxCreationDuration,
  activeSandboxes,
  startTimer,
  recordDuration
} from "./observability"

// Record HTTP request
const timer = httpRequestDuration.startTimer({ method: "GET", route: "/api/test" })
// ... handle request ...
timer({ status: "200" })
httpRequestsTotal.inc({ method: "GET", route: "/api/test", status: "200" })

// Record sandbox creation
const duration = await recordDuration(sandboxCreationDuration, {
  org_id: orgId,
  from_snapshot: "true"
}, async () => {
  return await createSandbox()
})

// Update gauge
activeSandboxes.inc({ org_id: orgId, status: "running" })
activeSandboxes.dec({ org_id: orgId, status: "running" })
```

---

## 5. Sentry Error Tracking

### 5.1 Initialization

```typescript
import { initSentry, shutdownSentry } from "./observability"

// On startup
initSentry()

// On shutdown
await shutdownSentry()
```

### 5.2 Capturing Exceptions

```typescript
import { captureException, captureMessage } from "./observability"

// Capture error with context
try {
  await riskyOperation()
} catch (error) {
  captureException(error, {
    tags: {
      operation: "sandbox.create",
      organizationId: orgId
    },
    extra: {
      sandboxConfig: config,
      attempt: 3
    },
    user: {
      id: userId,
      email: userEmail
    }
  })
  throw error
}

// Capture message
captureMessage("Sandbox creation slow", "warning", {
  tags: { threshold: "exceeded" },
  extra: { duration: 45000 }
})
```

### 5.3 User Context

```typescript
import { setUser, clearUser } from "./observability"

// Set user for subsequent events
setUser({
  id: userId,
  email: userEmail,
  organizationId: orgId
})

// Clear on logout
clearUser()
```

### 5.4 Breadcrumbs

```typescript
import { addBreadcrumb } from "./observability"

// Add navigation breadcrumb
addBreadcrumb("User navigated to workspace", "navigation", {
  workspaceId: "ws-123",
  from: "/projects"
})

// Add action breadcrumb
addBreadcrumb("Created sandbox", "action", {
  sandboxId: "sb-456",
  duration: 12000
}, "info")
```

### 5.5 Middleware Integration

The Sentry middleware automatically:
- Captures unhandled exceptions
- Adds request context (URL, method, headers)
- Links to OpenTelemetry trace IDs
- Filters noisy errors (ECONNRESET, EPIPE, etc.)

```typescript
// Automatic error capture
app.use("*", sentryMiddleware())
app.onError(sentryErrorHandler)
```

### 5.6 Trace ID Correlation

Sentry events automatically include OpenTelemetry trace IDs:

```typescript
// In Sentry dashboard
{
  tags: {
    trace_id: "abc123def456...",
    span_id: "789xyz..."
  }
}
```

This allows linking Sentry errors to distributed traces in Jaeger/Tempo.

---

## 6. Integration Guide

### 6.1 Adding New Metrics

1. **Define the metric:**

```typescript
// observability/metrics/definitions.ts
import { Histogram, Counter, Gauge } from "prom-client"
import { metricsRegistry } from "./definitions"

export const myNewMetric = new Histogram({
  name: "my_operation_duration_seconds",
  help: "Duration of my operation",
  labelNames: ["status", "type"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry]
})
```

2. **Export from index:**

```typescript
// observability/index.ts
export { myNewMetric } from "./metrics/definitions"
```

3. **Use in code:**

```typescript
import { myNewMetric } from "./observability"

const timer = myNewMetric.startTimer({ type: "create" })
await doOperation()
timer({ status: "success" })
```

### 6.2 Adding New Spans

1. **Use withSpan for async:**

```typescript
import { withSpan, SpanKind } from "./observability"

async function myOperation() {
  return await withSpan("my.operation", async (span) => {
    span.setAttribute("custom.key", "value")
    return await doWork()
  }, {
    kind: SpanKind.INTERNAL,
    attributes: { "initial.attr": "value" }
  })
}
```

2. **Use withSpanSync for sync:**

```typescript
import { withSpanSync } from "./observability"

function mySyncOperation() {
  return withSpanSync("my.sync.operation", (span) => {
    return computeValue()
  })
}
```

### 6.3 Custom Error Context

```typescript
import { captureException, addBreadcrumb } from "./observability"

async function complexOperation() {
  addBreadcrumb("Starting complex operation", "operation")

  try {
    addBreadcrumb("Step 1: Validate", "step")
    await validate()

    addBreadcrumb("Step 2: Process", "step")
    await process()

    addBreadcrumb("Step 3: Save", "step")
    await save()
  } catch (error) {
    captureException(error, {
      tags: {
        operation: "complex",
        step: getCurrentStep()
      },
      extra: {
        input: sanitizeInput(input),
        state: getCurrentState()
      }
    })
    throw error
  }
}
```

---

## 7. Dashboards & Alerts

### 7.1 Grafana Dashboard Queries

**Request Rate:**
```promql
sum(rate(http_requests_total[5m])) by (route)
```

**Request Latency (p99):**
```promql
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

**Error Rate:**
```promql
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

**Active Sandboxes:**
```promql
sum(active_sandboxes) by (org_id)
```

**Sandbox Creation Time (p95):**
```promql
histogram_quantile(0.95, sum(rate(sandbox_creation_duration_seconds_bucket[5m])) by (le))
```

**WebSocket Connections:**
```promql
sum(websocket_connections_active) by (type)
```

**Proxy Cache Hit Rate:**
```promql
sum(rate(proxy_resolution_duration_seconds_count{cache_hit="true"}[5m])) /
sum(rate(proxy_resolution_duration_seconds_count[5m]))
```

### 7.2 Alert Rules

**High Error Rate:**
```yaml
- alert: HighErrorRate
  expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "High error rate detected"
    description: "Error rate is {{ $value | humanizePercentage }}"
```

**Slow Sandbox Creation:**
```yaml
- alert: SlowSandboxCreation
  expr: histogram_quantile(0.95, sum(rate(sandbox_creation_duration_seconds_bucket[5m])) by (le)) > 120
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Sandbox creation is slow"
    description: "p95 sandbox creation time is {{ $value }}s"
```

**WebSocket Connection Spike:**
```yaml
- alert: WebSocketConnectionSpike
  expr: sum(websocket_connections_active) > 1000
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High WebSocket connections"
    description: "{{ $value }} active connections"
```

**Daytona API Errors:**
```yaml
- alert: DaytonaAPIErrors
  expr: sum(rate(daytona_api_duration_seconds_count{status="error"}[5m])) > 0.1
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Daytona API errors detected"
```

### 7.3 Jaeger Trace Queries

**Find slow sandbox creations:**
```
service=claxedo-gateway operation="sandbox.ensure_running" minDuration=30s
```

**Find proxy errors:**
```
service=claxedo-gateway operation="gateway.proxy.directory.fetch" error=true
```

**Find credential sync issues:**
```
service=claxedo-gateway operation="opencode.credentials.inject" error=true
```

---

## Appendix

### A. Metric Labels Reference

| Metric | Labels |
|--------|--------|
| `http_*` | method, route, status |
| `sandbox_*` | org_id, from_snapshot, status |
| `workspace_*` | org_id, has_repo, status |
| `session_*` | workspace_id, status |
| `pty_*` | workspace_id, status |
| `websocket_*` | type, direction, close_reason |
| `daytona_api_*` | operation, status |
| `convex_query_*` | operation, status |
| `proxy_*` | proxy_type, status, cache_hit |
| `credential_*` | org_id, provider, status |

### B. Histogram Buckets

| Metric Type | Buckets (seconds) |
|-------------|-------------------|
| HTTP latency | 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 |
| Sandbox creation | 1, 5, 10, 30, 60, 120, 300, 600 |
| Workspace wake | 0.5, 1, 2, 5, 10, 30, 60, 120 |
| PTY creation | 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5 |
| WebSocket latency | 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1 |
| Daytona API | 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120 |
| Convex query | 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5 |
| Proxy request | 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10 |

### C. Sentry Ignored Errors

The following errors are filtered by default:
- `ECONNRESET` - Connection reset
- `EPIPE` - Broken pipe
- `ETIMEDOUT` - Connection timeout
- `ResizeObserver loop limit exceeded` - Browser error
