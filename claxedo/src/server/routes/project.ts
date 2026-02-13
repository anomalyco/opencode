/**
 * Project routes: /project, /project/current, PATCH /project/:id
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { directoryFrom } from "../lib/paths.ts"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import { getIdentity } from "../middleware/auth.ts"
import { getProjectByDirectory } from "../../services/project-service.ts"
import type { GatewayContext } from "../context.ts"

import { logJson, nowMs } from "../lib/logging.ts"

export const ProjectRoutes = lazy(() =>
  new Hono<GatewayContext>()
    // List projects for the current organization
    .get("/", async (c) => {
      const t0 = nowMs()
      try {
        const identity = getIdentity(c)
        const organizationId = identity.organizationId
        const convex = getConvex()

        // Fetch aggregated projects (N+1 fixed)
        const tQuery = nowMs()
        const projects = await convex.query(api.projects.listByOrgWithWorkspaces, { organizationId })
        logJson("info", { kind: "project.query.aggregated", count: projects?.length, durationMs: nowMs() - tQuery })

        // Transform to OpenCode SDK format
        const transformed = projects.map((p: any) => {
          const workspaces = p.workspaces || []
          const running = workspaces.filter((w: any) => w.sandboxStatus === "running")
          const latest = running[0] || workspaces[0]
          const worktree = latest?.directory || ""
          const sandboxes = workspaces.map((w: any) => String(w.directory || "")).filter(Boolean)

          return {
            id: p.externalId || p._id.toString(),
            worktree,
            name: p.name,
            repoUrl: p.repoUrl,
            branch: p.branch,
            time: {
              created: p.createdAt,
              updated: p.updatedAt,
            },
            icon: p.icon || {},
            commands: p.commands || {},
            sandboxes,
          }
        })

        logJson("info", { kind: "project.total", durationMs: nowMs() - t0 })
        c.header("Cache-Control", "public, max-age=5, stale-while-revalidate=60")
        return c.json(transformed)
      } catch (err: any) {
        console.error("[Server] Failed to list projects:", err?.message)
        return c.json([])
      }
    })
    // Get current project for a directory
    .get("/current", async (c) => {
      const directory = directoryFrom(c)
      if (!directory) return c.json({ error: "Missing directory" }, 400)

      try {
        const t0 = nowMs()
        const identity = getIdentity(c)
        const project = await getProjectByDirectory(directory)

        if (!project) return c.json({ error: "Project not found for directory" }, 404)

        // Verify organization ownership
        if (project.organizationId && project.organizationId !== identity.organizationId) {
          return c.json({ error: "Forbidden: project belongs to different organization" }, 403)
        }

        const sandboxes = (project.workspaces ?? []).map((w: any) => String(w.directory || "")).filter(Boolean)

        const res = {
          id: project.id,
          worktree: directory,
          vcs: "git",
          name: project.name,
          icon: (project as any).icon || {},
          commands: (project as any).commands || {},
          time: {
            created: project.createdAt,
            updated: project.updatedAt,
          },
          sandboxes,
        }

        logJson("info", { kind: "project.current", durationMs: nowMs() - t0 })
        return c.json(res)
      } catch (err: any) {
        return c.json({ error: err?.message || String(err) }, 500)
      }
    })
    // Update project metadata
    .patch("/:id", async (c) => {
      const t0 = nowMs()
      try {
        const projectId = c.req.param("id")
        const body = (await c.req.json().catch(() => ({}))) as {
          name?: string
          icon?: { url?: string; override?: string; color?: string }
          commands?: { start?: string }
        }
        const directory = directoryFrom(c)
        const identity = getIdentity(c)

        const convex = getConvex()

        // Try to find project by external ID
        const tFind = nowMs()
        const project = await convex.query(api.projects.getByExternalId, { externalId: projectId }).catch(() => null)
        logJson("info", { kind: "project.patch.find", durationMs: nowMs() - tFind })

        if (!project) {
          return c.json({ error: "Project not found" }, 404)
        }

        // Verify organization ownership before allowing update
        if ((project as any).organizationId && (project as any).organizationId !== identity.organizationId) {
          return c.json({ error: "Forbidden: project belongs to different organization" }, 403)
        }

        // Update project fields if provided
        const hasUpdates = body.name !== undefined || body.icon !== undefined || body.commands !== undefined
        if (hasUpdates) {
          const tUpdate = nowMs()
          await convex
            .mutation(api.projects.update, {
              id: project._id,
              ...(body.name !== undefined && { name: body.name }),
              ...(body.icon !== undefined && { icon: body.icon }),
              ...(body.commands !== undefined && { commands: body.commands }),
            })
            .catch((err) => {
              logJson("error", { kind: "project.patch.update.failed", error: err?.message })
              return null
            })
          logJson("info", { kind: "project.patch.update", durationMs: nowMs() - tUpdate })
        }

        // Fetch updated project
        const updated = await convex.query(api.projects.getById, { id: project._id }).catch(() => project)

        // Fetch workspaces for this project
        const tWorkspaces = nowMs()
        const workspaces = await convex
          .query(api.workspaces.listByProject, { projectId: project._id.toString() })
          .catch(() => [])
        logJson("info", { kind: "project.patch.workspaces", durationMs: nowMs() - tWorkspaces })

        const running = (workspaces ?? []).filter((w: any) => w.sandboxStatus === "running")
        const latest = running[0] || (workspaces ?? [])[0]
        const worktree = directory || latest?.directory || ""
        const sandboxes = (workspaces ?? []).map((w: any) => String(w.directory || "")).filter(Boolean)

        // Return in OpenCode format with persisted values
        logJson("info", { kind: "project.patch.total", durationMs: nowMs() - t0 })
        return c.json({
          id: updated?.externalId || projectId,
          worktree,
          vcs: "git",
          name: updated?.name || "Project",
          icon: (updated as any)?.icon || body.icon || {},
          commands: (updated as any)?.commands || body.commands || {},
          time: {
            created: updated?.createdAt || Date.now(),
            updated: updated?.updatedAt || Date.now(),
          },
          sandboxes,
        })
      } catch (err: any) {
        logJson("error", { kind: "project.patch.failed", error: err?.message, durationMs: nowMs() - t0 })
        return c.json({ error: err?.message || String(err) }, 500)
      }
    }),
)
