/**
 * Sandbox resolution - maps workspaces/directories to upstream sandbox URLs
 * Includes auto-wake logic for sleeping sandboxes.
 */
import { getConvex } from "../clients/index.ts";
import { api } from "../../convex/_generated/api.js";
import { Config } from "../config/index.ts";
import { getSandboxPreviewBaseUrl, SandboxNotStartedError } from "./sandbox-preview.ts";
import { syncCredentialsToSandbox } from "./credential-sync.ts";
import { normalizeDirectory } from "../server/lib/paths.ts";
import { logJson, nowMs } from "../server/lib/logging.ts";
import { getOrchestrator } from "../orchestrator/index.ts";
import { memoizePromise } from "../server/lib/memoize.ts";

export interface ResolvedWorkspace {
  sandboxId?: string;
  sandboxUrl: string;
}

export interface ResolvedDirectory extends ResolvedWorkspace {
  workspaceId: string;
  directory: string;
}

/**
 * Resolve organization ID for a workspace
 * Cached for 1 minute as this mapping rarely changes.
 */
export const resolveOrganizationIdForWorkspace = memoizePromise(
  async (workspaceId: string): Promise<string | null> => {
    try {
      const workspace = await getConvex().query(api.workspaces.getById, {
        id: workspaceId as any,
      });
      const projectId = (workspace as any)?.projectId as string | undefined;
      if (!projectId) return null;

      const project = await getConvex().query(api.projects.getById, {
        id: projectId as any,
      });
      const organizationId = (project as any)?.organizationId as string | undefined;
      return organizationId ?? null;
    } catch {
      return null;
    }
  },
  60 * 1000, // 1 minute TTL
  15 * 60 * 1000 // 15 minutes SWR
);

async function _resolveWorkspaceUpstream(
  workspaceId: string,
  options?: { skipWake?: boolean }
): Promise<ResolvedWorkspace | null> {
  const t0 = nowMs();
  
  // 1. Convex: Get Workspace
  const tConvex = nowMs();
  const workspace = await getConvex().query(api.workspaces.getById, {
    id: workspaceId as any,
  });
  logJson("info", { kind: "resolve.step.convex_workspace", workspaceId, durationMs: nowMs() - tConvex });

  if (!workspace) {
    logJson("warn", { kind: "resolve.workspace.missing", workspaceId, durationMs: nowMs() - t0 });
    return null;
  }

  const sandboxId = (workspace as any)?.sandboxId as string | undefined;
  const sandboxStatus = (workspace as any)?.sandboxStatus as string | undefined;
  const directory = (workspace as any)?.directory as string | undefined;
  const storedUrl = (workspace as any)?.sandboxUrl as string | undefined;
  const port = Config.OPENCODE_PORT;

  // If sandbox is not running, wake it first
  if (sandboxStatus !== "running" && !options?.skipWake) {
    // 2. Sandbox: Wake
    const tWake = nowMs();
    logJson("info", { kind: "resolve.workspace.waking", workspaceId, sandboxId, sandboxStatus });

    try {
      const organizationId = await resolveOrganizationIdForWorkspace(workspaceId);
      if (organizationId) {
        const orchestrator = getOrchestrator();
        const sandbox = orchestrator.getSandbox(organizationId, workspaceId);

        // Wake the sandbox
        await sandbox.ensureRunning();

        // Ensure OpenCode server is running
        await (sandbox as any).ensureOpencodeServer?.({
          port,
          cwd: directory || "/home/daytona",
        });

        // Get fresh preview URL after waking
        const sandboxUrl = await sandbox.getServiceUrl(port);

        // Update workspace status in database
        await getConvex().mutation(api.workspaces.updateSandbox, {
          id: workspaceId as any,
          sandboxUrl,
          sandboxStatus: "running",
        });

        logJson("info", {
          kind: "resolve.step.wake_complete",
          workspaceId,
          sandboxId,
          durationMs: nowMs() - tWake,
        });

        void syncCredentialsToSandbox(sandboxUrl, organizationId);

        return { sandboxId, sandboxUrl };
      }
    } catch (err: any) {
      logJson("error", {
        kind: "resolve.workspace.wake_failed",
        workspaceId,
        sandboxId,
        error: err?.message || String(err),
        durationMs: nowMs() - tWake,
      });
      // Fall through to try getting preview URL anyway
    }
  }

  // Try to get a fresh signed preview URL
  if (sandboxId) {
    try {
      // 3. Auth/Signing: Get Preview URL
      const tSign = nowMs();
      const url = await getSandboxPreviewBaseUrl(sandboxId, port);
      logJson("info", { kind: "resolve.step.sign_url", workspaceId, sandboxId, durationMs: nowMs() - tSign });
      
      // Don't log "ok" every time when cached, but this function is the "miss" case so logging is fine
      logJson("info", {
        kind: "resolve.workspace.ok",
        workspaceId,
        sandboxId,
        via: "signedPreview",
        durationMs: nowMs() - t0,
      });

      const organizationId = await resolveOrganizationIdForWorkspace(workspaceId);
      if (organizationId) {
        void syncCredentialsToSandbox(url, organizationId);
      }

      return { sandboxId, sandboxUrl: url };
    } catch (err: any) {
      // If sandbox is not started (e.g. auto-stopped), wake it
      if (err instanceof SandboxNotStartedError && !options?.skipWake) {
        const tWakeStopped = nowMs();
        logJson("info", {
          kind: "resolve.workspace.sandbox_stopped",
          workspaceId,
          sandboxId,
          state: err.state,
          durationMs: nowMs() - t0,
        });

        try {
          const organizationId = await resolveOrganizationIdForWorkspace(workspaceId);
          if (organizationId) {
            const orchestrator = getOrchestrator();
            const sandbox = orchestrator.getSandbox(organizationId, workspaceId);

            // Wake the sandbox
            logJson("info", { kind: "resolve.workspace.waking_stopped", workspaceId, sandboxId });
            await sandbox.ensureRunning();

            // Ensure OpenCode server is running
            await (sandbox as any).ensureOpencodeServer?.({
              port,
              cwd: directory || "/home/daytona",
            });

            // Get fresh preview URL after waking
            const sandboxUrl = await sandbox.getServiceUrl(port);

            // Update workspace status in database
            await getConvex().mutation(api.workspaces.updateSandbox, {
              id: workspaceId as any,
              sandboxUrl,
              sandboxStatus: "running",
            });

            logJson("info", {
              kind: "resolve.step.wake_stopped_complete",
              workspaceId,
              sandboxId,
              durationMs: nowMs() - tWakeStopped,
            });

            void syncCredentialsToSandbox(sandboxUrl, organizationId);

            return { sandboxId, sandboxUrl };
          }
        } catch (wakeErr: any) {
          logJson("error", {
            kind: "resolve.workspace.wake_stopped_failed",
            workspaceId,
            sandboxId,
            error: wakeErr?.message || String(wakeErr),
            durationMs: nowMs() - tWakeStopped,
          });
        }
      } else {
        console.warn(
          `[Gateway] Failed to refresh signed preview url for ${sandboxId}: ${err?.message || String(err)}`
        );
      }
    }
  }

  // Fallback to stored URL
  if (storedUrl) {
    const url = storedUrl.replace(/\/+$/, "");
    logJson("info", {
      kind: "resolve.workspace.ok",
      workspaceId,
      sandboxId,
      via: "storedUrl",
      durationMs: nowMs() - t0,
    });

    const organizationId = await resolveOrganizationIdForWorkspace(workspaceId);
    if (organizationId) {
      void syncCredentialsToSandbox(url, organizationId);
    }

    return { sandboxId, sandboxUrl: url };
  }

  logJson("warn", {
    kind: "resolve.workspace.no_url",
    workspaceId,
    sandboxId,
    durationMs: nowMs() - t0,
  });
  return null;
}

/**
 * Resolve a workspace ID to its upstream sandbox URL.
 * Automatically wakes sleeping sandboxes.
 * Cached for 5 seconds to prevent DB hammering on every request.
 */
export const resolveWorkspaceUpstream = memoizePromise(
  _resolveWorkspaceUpstream,
  5 * 1000, // 5 seconds TTL
  15 * 60 * 1000 // 15 minutes SWR
);

/**
 * Resolve a directory to its upstream sandbox URL
 */
export const resolveDirectoryUpstream = memoizePromise(
  async (directory: string): Promise<ResolvedDirectory | null> => {
    const value = normalizeDirectory(directory);
    if (!value) return null;
    if (value === "/workspace") return null;

    const workspace = await getConvex().query(api.workspaces.getByDirectory, {
      directory: value,
    });
    if (!workspace) return null;

    const workspaceId = String((workspace as any)._id);
    const resolved = await resolveWorkspaceUpstream(workspaceId);
    if (!resolved?.sandboxUrl) return null;

    return {
      workspaceId,
      sandboxId: resolved.sandboxId,
      sandboxUrl: resolved.sandboxUrl,
      directory: value,
    };
  },
  5 * 1000, // 5 seconds TTL
  15 * 60 * 1000 // 15 minutes SWR
);

/**
 * Extended resolver that also checks for user backends (tunnel mode).
 * Used when a directory doesn't have a sandbox but the user has a registered backend.
 */
export async function resolveDirectoryUpstreamWithTunnel(
  directory: string,
  userId?: string
): Promise<ResolvedDirectory | null> {
  // First try the standard sandbox resolution
  const sandboxResolved = await resolveDirectoryUpstream(directory);
  if (sandboxResolved) {
    return sandboxResolved;
  }

  // If user has a registered backend (tunnel), try that
  if (userId) {
    try {
      const backend = await getConvex().query(api.backends.get, { userId });
      if (backend?.backendUrl) {
        const value = normalizeDirectory(directory);
        if (!value) return null;

        return {
          workspaceId: `local-${userId}`,
          sandboxUrl: backend.backendUrl,
          directory: value,
          // Note: no sandboxId since this is a tunnel, not a sandbox
        };
      }
    } catch (err) {
      logJson("warn", {
        kind: "resolve.tunnel.failed",
        userId,
        directory,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
}

