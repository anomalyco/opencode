# @opencode-ai/analytics

Prometheus-compatible metrics plugin for OpenCode. Automatically tracks tool usage, execution timing, and session activity.

## Installation

```bash
# Add to your opencode config
{
  "plugin": ["@opencode-ai/analytics"]
}
```

## Metrics Exposed

### Counters
- `opencode_tool_calls_total{tool, status}` - Total tool calls by tool name and status (success/error)
- `opencode_messages_total{type}` - Total messages by type
- `opencode_tokens_total{type, model}` - Token usage by type and model
- `opencode_errors_total{type}` - Total errors by type

### Histograms
- `opencode_tool_duration_ms{tool}` - Tool execution duration in milliseconds

### Gauges
- `opencode_sessions_active` - Number of active sessions
- `opencode_tool_calls_inflight{tool}` - Currently executing tool calls

## Usage

Once enabled, metrics are collected automatically via the `tool.execute.before` and `tool.execute.after` hooks.

### Get Metrics

Use the `metrics` tool to retrieve current metrics:

```
/metrics
```

Returns Prometheus exposition format:

```
# HELP opencode_tool_calls_total Total number of tool calls
# TYPE opencode_tool_calls_total counter
opencode_tool_calls_total{tool="Read",status="success"} 42
opencode_tool_calls_total{tool="Write",status="success"} 15

# HELP opencode_tool_duration_ms Tool execution duration in milliseconds
# TYPE opencode_tool_duration_ms histogram
opencode_tool_duration_ms_bucket{tool="Read",le="100"} 38
opencode_tool_duration_ms_bucket{tool="Read",le="500"} 42
...
```

## Scraping with Prometheus

To expose metrics for Prometheus scraping, you can create an HTTP endpoint that calls `formatMetrics()`:

```typescript
import { formatMetrics } from "@opencode-ai/analytics"

// In your server
app.get("/metrics", (req, res) => {
  res.type("text/plain")
  res.send(formatMetrics())
})
```

## Configuration

No configuration required. The plugin automatically hooks into OpenCode's plugin system.

## License

MIT
