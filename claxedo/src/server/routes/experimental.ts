/**
 * Experimental routes: /api/experimental/*
 */
import { Hono } from "hono"
import { lazy } from "../lib/lazy.ts"
import { directoryFrom } from "../lib/paths.ts"
import { getConvex } from "../../clients/index.ts"
import { api } from "../../../convex/_generated/api.js"
import type { Id } from "../../../convex/_generated/dataModel.d.ts"
import { getOrchestrator } from "../../orchestrator/index.ts"
import { resolveOrganizationIdForWorkspace } from "../../services/sandbox-resolver.ts"
import { getIdentity } from "../middleware/auth.ts"
import type { GatewayContext } from "../context.ts"
import { logJson, nowMs } from "../lib/logging.ts"

export const ExperimentalRoutes = lazy(() =>
  new Hono<GatewayContext>()
    .delete("/sandbox", async (c) => {
      const t0 = nowMs()
      const directory = directoryFrom(c)

      if (!directory) {
        return c.json({ error: "Missing directory" }, 400)
      }

      try {
        const identity = getIdentity(c)

        const workspace = await getConvex().query(api.workspaces.getByDirectory, { directory })
        if (!workspace) {
          return c.json({ error: "Sandbox not found for directory" }, 404)
        }

        const workspaceId = String(workspace._id)
        const sandboxId = workspace.sandboxId

        // Ownership check - verify workspace belongs to user's organization
        const organizationId = await resolveOrganizationIdForWorkspace(workspaceId)
        if (!organizationId) {
          return c.json({ error: "Could not determine organization for workspace" }, 500)
        }

        // Verify user belongs to the organization that owns this workspace
        if (organizationId !== identity.organizationId) {
          return c.json({ error: "Forbidden: sandbox belongs to different organization" }, 403)
        }

        const orchestrator = getOrchestrator()
        const sandbox = orchestrator.getSandbox(organizationId, workspaceId)
        
        logJson("info", { 
           kind: "experimental.sandbox.delete", 
           workspaceId, 
           sandboxId,
           directory 
        })

        await sandbox
          .destroy()
          .catch((err) =>
            logJson("warn", { kind: "experimental.sandbox.destroy.failed", workspaceId, error: String(err) }),
          )
        
        // Delete from DB
        await getConvex().mutation(api.workspaces.deleteWorkspace, {
          id: workspaceId as Id<"workspaces">,
        })
        
        logJson("info", { 
           kind: "experimental.sandbox.delete.success", 
           workspaceId, 
           durationMs: nowMs() - t0 
        })

        return c.json({ success: true })
      } catch (err: any) {
         logJson("error", { 
            kind: "experimental.sandbox.delete.failed", 
            error: err?.message || String(err),
            durationMs: nowMs() - t0 
         })
         return c.json({ error: err?.message || String(err) }, 500)
      }
    })
)
