/**
 * Agent Hook Routes
 *
 * Receives lifecycle hook callbacks from CLI agents (Claude, Codex, etc.)
 * running in terminals (either in cloud sandboxes or local desktop)
 * and broadcasts events for the frontend to update tab status indicators.
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { broadcastGlobal } from "../events/index.ts"
import type { GatewayContext } from "../context.ts"

/**
 * Agent lifecycle event types
 */
const VALID_EVENT_TYPES = new Set(["Start", "Stop", "PermissionRequest"])

// Debug flag
const DEBUG = process.env.CLAXEDO_DEBUG === "1"

function debugLog(message: string, data?: Record<string, unknown>) {
  if (DEBUG) {
    console.log(`[agent-hook:debug] ${message}`, data ?? "")
  }
}

export const AgentHookRoutes = lazy(() =>
  new Hono<GatewayContext>()
    // GET endpoint for curl from notify.sh (uses query params)
    .get("/agent-lifecycle", async (c) => {
      const tabId = c.req.query("tabId")
      const terminalId = c.req.query("terminalId")
      const workspaceId = c.req.query("workspaceId")
      const eventType = c.req.query("eventType")

      debugLog("GET /agent-lifecycle received", {
        tabId,
        terminalId,
        workspaceId,
        eventType,
        url: c.req.url,
      })

      // Validate required params
      if (!tabId) {
        debugLog("Missing tabId, returning 400")
        return c.json({ success: false, error: "Missing tabId" }, 400)
      }
      if (!eventType) {
        debugLog("Missing eventType, returning 400")
        return c.json({ success: false, error: "Missing eventType" }, 400)
      }

      // Validate eventType
      if (!VALID_EVENT_TYPES.has(eventType)) {
        console.warn("[agent-hook] Invalid eventType:", eventType)
        return c.json({ success: false, error: `Invalid eventType: ${eventType}` }, 400)
      }

      console.log("[agent-hook] lifecycle event:", { tabId, terminalId, workspaceId, eventType })

      // Broadcast event for frontend to consume via SSE
      // Use "global" directory so all clients receive it
      const broadcastPayload = {
        directory: "global",
        payload: {
          type: "agent.lifecycle",
          properties: {
            tabId,
            terminalId,
            workspaceId,
            eventType,
          },
        },
      }

      debugLog("Broadcasting to global SSE", broadcastPayload)

      void broadcastGlobal(broadcastPayload)

      debugLog("Broadcast complete, returning success")

      return c.json({
        success: true,
        tabId,
        eventType,
      })
    })
    // POST endpoint for direct API calls
    .post("/agent-lifecycle", async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const { tabId, terminalId, workspaceId, eventType } = body

      debugLog("POST /agent-lifecycle received", body)

      // Validate required params
      if (!tabId) {
        debugLog("Missing tabId in POST body, returning 400")
        return c.json({ success: false, error: "Missing tabId" }, 400)
      }
      if (!eventType) {
        debugLog("Missing eventType in POST body, returning 400")
        return c.json({ success: false, error: "Missing eventType" }, 400)
      }

      // Validate eventType
      if (!VALID_EVENT_TYPES.has(eventType)) {
        console.warn("[agent-hook] Invalid eventType (POST):", eventType)
        return c.json({ success: false, error: `Invalid eventType: ${eventType}` }, 400)
      }

      console.log("[agent-hook] lifecycle event (POST):", { tabId, terminalId, workspaceId, eventType })

      // Broadcast event for frontend to consume via SSE
      const broadcastPayload = {
        directory: "global",
        payload: {
          type: "agent.lifecycle",
          properties: {
            tabId,
            terminalId,
            workspaceId,
            eventType,
          },
        },
      }

      debugLog("Broadcasting to global SSE (POST)", broadcastPayload)

      void broadcastGlobal(broadcastPayload)

      return c.json({ success: true })
    })
)
