/**
 * Workspace routes: /api/workspace/create, /api/workspace/resolve, /api/workspace/wake
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import { getIdentity } from "../middleware/auth.ts"
import { getOrchestrator } from "../../orchestrator/index.ts"
import { Config } from "../../config/index.ts"
import type { GatewayContext } from "../context.ts"

export const WorkspaceWakeHandler = lazy(() => async (c: any) => {
  const body = await c.req.json()
  const workspaceId = body?.workspaceId
  if (!workspaceId) return c.json({ error: "Missing workspaceId" }, 400)

  const identity = getIdentity(c)

  try {
    // Verify workspace ownership before waking
    const workspace = await getConvex().query(api.workspaces.getById, { id: workspaceId as any })
    if (!workspace) return c.json({ error: "Workspace not found" }, 404)

    const projectId = (workspace as any).projectId
    if (projectId) {
      const project = await getConvex().query(api.projects.getById, { id: projectId as any })
      if (project && (project as any).organizationId !== identity.organizationId) {
        return c.json({ error: "Forbidden: workspace belongs to different organization" }, 403)
      }
    }

    const orchestrator = getOrchestrator()
    const sandbox = orchestrator.getSandbox(identity.organizationId, workspaceId)

    console.log(`[Server] Waking sandbox for workspace ${workspaceId}...`)
    await sandbox.ensureRunning()

    // Also ensure OpenCode server is running
    const opencodePort = Number.parseInt(process.env.OPENCODE_PORT || "4096", 10)
    const directory = (workspace as any)?.directory || "/home/daytona"

    await (sandbox as any).ensureOpencodeServer?.({
      port: opencodePort,
      cwd: directory,
    })

    const sandboxUrl = await sandbox.getServiceUrl(opencodePort)

    // Update workspace status
    await getConvex().mutation(api.workspaces.updateSandbox, {
      id: workspaceId as any,
      sandboxUrl,
      sandboxStatus: "running",
    })

    const baseUrl = Config.gatewayBaseUrl
    const workspaceBaseUrl = `${baseUrl}/w/${workspaceId}`

    return c.json({
      ok: true,
      workspaceId,
      workspaceBaseUrl,
      sandboxUrl,
    })
  } catch (err: any) {
    console.error("[Server] Workspace wake failed:", err)
    return c.json({ error: err?.message || "Failed to wake workspace" }, 500)
  }
})

export const WorkspaceCreateHandler = lazy(() => async (c: any) => {
  const body = await c.req.json()
  const identity = getIdentity(c)

  try {
    const orchestrator = getOrchestrator()

    const result = await orchestrator.createSandbox({
      projectId: body.projectId,
      projectExternalId: body.projectExternalId,
      projectName: body.projectName,
      workspaceName: body.workspaceName,
      branch: body.branch,
      organizationId: identity.organizationId,
      userId: identity.userId,
      repoUrl: body.repoUrl,
    })

    const baseUrl = Config.gatewayBaseUrl
    const workspaceId = result.workspaceId
    const workspaceBaseUrl = workspaceId ? `${baseUrl}/w/${workspaceId}` : undefined

    return c.json({ ...result, workspaceBaseUrl })
  } catch (err: any) {
    console.error("[Server] Workspace creation failed:", err?.message || err?.data || err)
    console.error("[Server] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)))
    return c.json({ error: err?.message || err?.data?.message || "Workspace creation failed" }, 500)
  }
})

export const WorkspaceResolveHandler = lazy(() => async (c: any) => {
  const directory = c.req.query("directory")
  if (!directory) return c.json({ error: "Missing directory" }, 400)

  const identity = getIdentity(c)

  try {
    const workspace = await getConvex().query(api.workspaces.getByDirectory, { directory })
    if (!workspace) return c.json({ error: "Workspace not found" }, 404)

    // Verify ownership: workspace's project must belong to user's organization
    const projectId = (workspace as any).projectId
    if (projectId) {
      const project = await getConvex().query(api.projects.getById, { id: projectId as any })
      if (project && (project as any).organizationId !== identity.organizationId) {
        return c.json({ error: "Forbidden: workspace belongs to different organization" }, 403)
      }
    }

    const baseUrl = Config.gatewayBaseUrl
    const workspaceId = String((workspace as any)._id)
    const workspaceBaseUrl = `${baseUrl}/w/${workspaceId}`

    return c.json({
      workspaceId,
      projectId,
      directory: (workspace as any).directory,
      workspaceBaseUrl,
    })
  } catch (err: any) {
    return c.json({ error: err?.message || String(err) }, 500)
  }
})

// Keep original routes for backward compatibility
export const WorkspaceRoutes = lazy(() =>
  new Hono<GatewayContext>()
    .post("/wake", WorkspaceWakeHandler())
    .post("/create", WorkspaceCreateHandler())
    .get("/resolve", WorkspaceResolveHandler()),
)
