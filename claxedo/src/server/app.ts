/**
 * Hono app factory with middleware composition
 */
import { Hono } from "hono"
import { logger } from "hono/logger"
import { serveStatic } from "@hono/node-server/serve-static"
import { existsSync } from "node:fs"
import { lazy } from "./lib/lazy.ts"
import { requestIdMiddleware, corsMiddleware } from "./middleware/index.ts"
import { requireAuth, requireWorkspaceAccess } from "./middleware/auth.ts"
import {
  GlobalRoutes,
  ProjectRoutes,
  ProviderRoutes,
  SessionRoutes,
  AuthRoutes,
  BackendRoutes,
  WorkspaceRoutes,
  WorkspaceCreateHandler,
  WorkspaceWakeHandler,
  WorkspaceResolveHandler,
  ExperimentalRoutes,
  AgentHookRoutes,
  SandboxAgentRoutes,
  shouldDirectoryProxy,
} from "./routes/index.ts"
import { LocalProxyMiddleware } from "./proxy/local.ts"
import { SandboxAgentProxyMiddleware } from "./proxy/agent.ts"
import { DirectoryProxyMiddleware } from "./proxy/directory.ts"
import { WorkspaceProxyRoutes } from "./proxy/workspace.ts"
import { Config } from "../config/index.ts"
import type { GatewayContext } from "./context.ts"
import {
  tracingMiddleware,
  metricsMiddleware,
  sentryMiddleware,
  MetricsRoutes,
  observabilityConfig,
} from "../observability/index.ts"

export const App = lazy(() => {
  const app = new Hono<GatewayContext>()

  // ═══════════════════════════════════════════════════════════════
  // GLOBAL MIDDLEWARE (Order matters!)
  // ═══════════════════════════════════════════════════════════════
  app.use("*", logger())
  app.use("*", requestIdMiddleware())
  app.use("*", corsMiddleware())

  // Observability middleware
  if (observabilityConfig.otelEnabled) {
    app.use("*", tracingMiddleware())
  }
  if (observabilityConfig.prometheusEnabled) {
    app.use("*", metricsMiddleware())
  }
  if (observabilityConfig.sentryEnabled) {
    app.use("*", sentryMiddleware())
  }

  // ═══════════════════════════════════════════════════════════════
  // METRICS ENDPOINT (no auth required)
  // ═══════════════════════════════════════════════════════════════
  if (observabilityConfig.prometheusEnabled) {
    app.route("/", MetricsRoutes())
  }

  // ═══════════════════════════════════════════════════════════════
  // GATEWAY HEALTH (no auth — used by Fly.io / Docker health checks)
  // ═══════════════════════════════════════════════════════════════
  app.get("/api/health", (c) => c.json({ healthy: true, version: "claxedo-gateway" }))

  // ═══════════════════════════════════════════════════════════════
  // SANDBOX AGENT (must be before other routes to intercept when active)
  // ═══════════════════════════════════════════════════════════════
  // Management API (spawn/stop/status) - no auth required (local dev tool)
  if (Config.USE_RIVET_SANDBOX_AGENT_SERVER) {
    app.route("/api/sandbox-agent", SandboxAgentRoutes())
  }

  // 1. Explicit Proxy Switch (Cloud vs Agent vs Local)
  // ═══════════════════════════════════════════════════════════════
  if (Config.SANDBOX_ENABLED) {
    // CLOUD MODE: Directory Proxy + Workspace Proxy
    app.route("/", DirectoryProxyMiddleware())
    app.route("/", WorkspaceProxyRoutes())
  } else if (Config.USE_RIVET_SANDBOX_AGENT_SERVER) {
    // HYBRID MODE: Sandbox Agent Proxy
    app.route("/", SandboxAgentProxyMiddleware())
  } else {
    // LOCAL MODE: Local Server Proxy
    app.route("/", LocalProxyMiddleware())
  }
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // MEMBER ROUTES (any authenticated user)
  // These handle requests WITHOUT directory (fallback/stub routes)
  // ═══════════════════════════════════════════════════════════════
  const memberRoutes = new Hono<GatewayContext>()
  memberRoutes.use("*", requireAuth("member"))

  // Core API (Mount first to avoid masking)
  memberRoutes.route("/api/experimental", ExperimentalRoutes())
  memberRoutes.get("/api/workspace/resolve", WorkspaceResolveHandler())

  // Health & Events
  memberRoutes.route("/global", GlobalRoutes())



  // Core API
  memberRoutes.route("/project", ProjectRoutes())
  memberRoutes.route("/session", SessionRoutes())
  memberRoutes.route("/provider", ProviderRoutes())
  memberRoutes.route("/api/backend", BackendRoutes())

  app.route("/", memberRoutes)

  // ═══════════════════════════════════════════════════════════════
  // ADMIN ROUTES (admin role required)
  // ═══════════════════════════════════════════════════════════════
  const adminRoutes = new Hono<GatewayContext>()
  adminRoutes.use("*", requireAuth("admin"))

  adminRoutes.route("/auth", AuthRoutes())
  adminRoutes.post("/api/workspace/create", WorkspaceCreateHandler())
  adminRoutes.post("/api/workspace/wake", WorkspaceWakeHandler())

  app.route("/", adminRoutes)

  // ═══════════════════════════════════════════════════════════════
  // PROXY ROUTES (workspace ownership)
  // ═══════════════════════════════════════════════════════════════
  const proxyRoutes = new Hono<GatewayContext>()
  proxyRoutes.use("*", requireWorkspaceAccess())
  proxyRoutes.route("/", WorkspaceProxyRoutes())

  app.route("/", proxyRoutes)

  // ═══════════════════════════════════════════════════════════════
  // STATIC FILES + SPA FALLBACK
  // ═══════════════════════════════════════════════════════════════
  const staticDir = process.env.STATIC_DIR
  if (staticDir && existsSync(staticDir)) {
    // Serve static assets (JS, CSS, images, etc.)
    app.use("*", serveStatic({ root: staticDir, rewriteRequestPath: (p) => p }))
    // SPA fallback: serve index.html for all unmatched routes
    app.get("*", serveStatic({ root: staticDir, rewriteRequestPath: () => "/index.html" }))
  } else {
    app.get("/", (c) => c.text("Claxedo Server Running"))
  }

  return app
})
