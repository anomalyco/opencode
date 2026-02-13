/**
 * Backend Routes
 *
 * API endpoints for managing user-registered backend URLs (tunnel mode).
 * Allows users to register their local OpenCode servers for remote access.
 */

import { Hono } from "hono"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import type { GatewayContext } from "../context.ts"

export function BackendRoutes() {
  const app = new Hono<GatewayContext>()

  /**
   * Register user's tunnel URL
   * POST /api/backend/register
   */
  app.post("/register", async (c) => {
    const auth = c.get("auth")
    if (!auth?.userId || !auth?.orgId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const body = await c.req.json<{ backendUrl: string }>()
    if (!body.backendUrl) {
      return c.json({ error: "backendUrl is required" }, 400)
    }

    // Validate URL format
    try {
      new URL(body.backendUrl)
    } catch {
      return c.json({ error: "Invalid URL format" }, 400)
    }

    await getConvex().mutation(api.backends.register, {
      userId: auth.userId,
      organizationId: auth.orgId,
      backendUrl: body.backendUrl,
    })

    return c.json({ success: true })
  })

  /**
   * Get user's registered backend
   * GET /api/backend
   */
  app.get("/", async (c) => {
    const auth = c.get("auth")
    if (!auth?.userId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const backend = await getConvex().query(api.backends.get, {
      userId: auth.userId,
    })

    return c.json(backend)
  })

  /**
   * List all backends in the organization
   * GET /api/backend/org
   */
  app.get("/org", async (c) => {
    const auth = c.get("auth")
    if (!auth?.orgId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const backends = await getConvex().query(api.backends.listByOrg, {
      organizationId: auth.orgId,
    })

    return c.json(backends)
  })

  /**
   * Heartbeat to update lastSeen timestamp
   * POST /api/backend/heartbeat
   */
  app.post("/heartbeat", async (c) => {
    const auth = c.get("auth")
    if (!auth?.userId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const success = await getConvex().mutation(api.backends.heartbeat, {
      userId: auth.userId,
    })

    return c.json({ success })
  })

  /**
   * Remove registration
   * DELETE /api/backend
   */
  app.delete("/", async (c) => {
    const auth = c.get("auth")
    if (!auth?.userId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    const success = await getConvex().mutation(api.backends.remove, {
      userId: auth.userId,
    })

    return c.json({ success })
  })

  return app
}
