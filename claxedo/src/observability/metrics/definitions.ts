/**
 * Prometheus Metrics Definitions
 * All metric definitions for the Claxedo gateway
 */
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

// Create a custom registry
export const metricsRegistry = new Registry();

// Add default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// ═══════════════════════════════════════════════════════════════
// HTTP METRICS
// ═══════════════════════════════════════════════════════════════

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// SANDBOX METRICS
// ═══════════════════════════════════════════════════════════════

export const sandboxCreationDuration = new Histogram({
  name: "sandbox_creation_duration_seconds",
  help: "Time to create a sandbox",
  labelNames: ["org_id", "from_snapshot", "status"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

export const sandboxCreationsTotal = new Counter({
  name: "sandbox_creations_total",
  help: "Total number of sandbox creations",
  labelNames: ["org_id", "from_snapshot", "status"] as const,
  registers: [metricsRegistry],
});

export const activeSandboxes = new Gauge({
  name: "active_sandboxes",
  help: "Number of currently active sandboxes",
  labelNames: ["org_id", "status"] as const,
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// WORKSPACE METRICS
// ═══════════════════════════════════════════════════════════════

export const workspaceCreationDuration = new Histogram({
  name: "workspace_creation_duration_seconds",
  help: "End-to-end workspace creation time",
  labelNames: ["org_id", "has_repo", "status"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

export const workspaceWakeDuration = new Histogram({
  name: "workspace_wake_duration_seconds",
  help: "Time to wake a sleeping workspace",
  labelNames: ["org_id", "status"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

export const workspaceDeletionDuration = new Histogram({
  name: "workspace_deletion_duration_seconds",
  help: "Time to delete a workspace",
  labelNames: ["org_id", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// SESSION METRICS
// ═══════════════════════════════════════════════════════════════

export const sessionCreationDuration = new Histogram({
  name: "session_creation_duration_seconds",
  help: "Time to create a session",
  labelNames: ["workspace_id", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const activeSessions = new Gauge({
  name: "active_sessions",
  help: "Number of currently active sessions",
  labelNames: ["workspace_id"] as const,
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// PTY/TERMINAL METRICS
// ═══════════════════════════════════════════════════════════════

export const ptyCreationDuration = new Histogram({
  name: "pty_creation_duration_seconds",
  help: "Time to spawn a PTY",
  labelNames: ["workspace_id", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const ptyFirstByteDuration = new Histogram({
  name: "pty_first_byte_duration_seconds",
  help: "Time to first output byte from PTY",
  labelNames: ["workspace_id"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET METRICS
// ═══════════════════════════════════════════════════════════════

export const websocketConnectionsActive = new Gauge({
  name: "websocket_connections_active",
  help: "Number of active WebSocket connections",
  labelNames: ["type"] as const, // pty, event, etc.
  registers: [metricsRegistry],
});

export const websocketMessagesTotal = new Counter({
  name: "websocket_messages_total",
  help: "Total number of WebSocket messages",
  labelNames: ["type", "direction"] as const, // direction: in, out
  registers: [metricsRegistry],
});

export const websocketMessageLatency = new Histogram({
  name: "websocket_message_latency_seconds",
  help: "WebSocket message round-trip latency",
  labelNames: ["type"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [metricsRegistry],
});

export const websocketConnectionDuration = new Histogram({
  name: "websocket_connection_duration_seconds",
  help: "WebSocket connection lifetime",
  labelNames: ["type", "close_reason"] as const,
  buckets: [1, 5, 30, 60, 300, 600, 1800, 3600],
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// EXTERNAL API METRICS
// ═══════════════════════════════════════════════════════════════

export const daytonaApiDuration = new Histogram({
  name: "daytona_api_duration_seconds",
  help: "Daytona API call latency",
  labelNames: ["operation", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

export const convexQueryDuration = new Histogram({
  name: "convex_query_duration_seconds",
  help: "Convex query/mutation latency",
  labelNames: ["operation", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// PROXY METRICS
// ═══════════════════════════════════════════════════════════════

export const proxyRequestDuration = new Histogram({
  name: "proxy_request_duration_seconds",
  help: "Time to proxy request to upstream",
  labelNames: ["proxy_type", "status"] as const, // proxy_type: directory, workspace
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

export const proxyResolutionDuration = new Histogram({
  name: "proxy_resolution_duration_seconds",
  help: "Time to resolve upstream URL",
  labelNames: ["proxy_type", "cache_hit"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [metricsRegistry],
});

// ═══════════════════════════════════════════════════════════════
// CREDENTIAL SYNC METRICS
// ═══════════════════════════════════════════════════════════════

export const credentialSyncDuration = new Histogram({
  name: "credential_sync_duration_seconds",
  help: "Time to sync credentials to sandbox",
  labelNames: ["org_id", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const credentialSyncTotal = new Counter({
  name: "credential_sync_total",
  help: "Total credential sync operations",
  labelNames: ["org_id", "provider", "status"] as const,
  registers: [metricsRegistry],
});
