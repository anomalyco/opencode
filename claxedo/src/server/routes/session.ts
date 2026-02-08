/**
 * Session routes: /session
 *
 * GET  /session   — list from Convex cache (fast, no sandbox needed)
 * POST /session   — create: forward to sandbox, sync result to Convex
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { logJson, nowMs } from "../lib/logging.ts"
import { directoryFrom } from "../lib/paths.ts"

import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import { getIdentity } from "../middleware/auth.ts"
import { Config } from "../../config/index.ts"
import type { GatewayContext } from "../context.ts"

export const SessionRoutes = lazy(() =>
  new Hono<GatewayContext>()
    // Session list - served from Convex Cache when available, else forwarded
    .get("/", async (c) => {
      const t0 = nowMs()
      try {
        const directory = directoryFrom(c)
        if (!directory) return c.json([])

        // Without Convex (local dev), forward to OpenCode server
        if (!Config.CONVEX_URL) {
          // Without Convex (local dev), the LocalBackendProxy should have handled this if the server was local.
          // If we got here, it means we have no directory context AND no cloud.
          return c.json([])
        }

        const identity = getIdentity(c)

        // Directory -> WorkspaceId (no sandbox wake required)
        const tWs = nowMs()
        const workspace = await getConvex().query(api.workspaces.getByDirectory, { directory })
        logJson("info", { kind: "session.list.workspace", durationMs: nowMs() - tWs })

        if (!workspace) return c.json([])

        // Verify organization ownership
        const projectId = (workspace as any).projectId
        if (projectId) {
          const project = await getConvex().query(api.projects.getById, { id: projectId as any })
          if (project && (project as any).organizationId !== identity.organizationId) {
            return c.json({ error: "Forbidden: workspace belongs to different organization" }, 403)
          }
        }
        const workspaceId = String(workspace._id)

        const convex = getConvex()
        // Fetch cached sessions
        const tList = nowMs()
        const sessions = await convex.query(api.sessions.list, {
          workspaceId,
        })
        logJson("info", { kind: "session.list.query", count: sessions.length, durationMs: nowMs() - tList })

        // Map to SDK Session format
        const userSessions = sessions.map((s) => ({
          id: s.sessionId,
          slug: s.slug || s.sessionId,
          title: s.title,
          projectID: workspace.projectId,
          directory,
          time: {
            created: s.createdAt,
            updated: s.updatedAt,
          },
          // Defaults for fields not yet synced
          permission: [],
        }))

        logJson("info", { kind: "session.list.total", durationMs: nowMs() - t0 })
        return c.json(userSessions)
      } catch (err: any) {
        logJson("error", { kind: "session.list.failed", error: err?.message, durationMs: nowMs() - t0 })
        return c.json({ error: err?.message || String(err) }, 500)
      }
    })
    // Session create - forward to sandbox, fall back to informative error
    .post("/", async (c) => {


      const directory = directoryFrom(c)
      if (directory) {
        return c.json(
          {
            error: "No sandbox found for this directory. The workspace may need to be created or woken up.",
            directory,
          },
          502,
        )
      }
      return c.json(
        { error: "No project directory specified. Select a project first." },
        400,
      )
    }),
)
