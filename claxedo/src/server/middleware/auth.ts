import type { MiddlewareHandler, Context } from "hono"
import type { GatewayContext, GatewayVariables } from "../context.ts"
import type { OrganizationRole, AuthenticatedIdentity } from "../types/roles.ts"
import { hasRole } from "../types/roles.ts"
import { resolveIdentity } from "../../services/identity.ts"
import { resolveOrganizationIdForWorkspace } from "../../services/sandbox-resolver.ts"
import { Config } from "../../config/index.ts"

const DEV_IDENTITY: AuthenticatedIdentity = {
  ok: true as const,
  token: "dev",
  userId: "dev",
  organizationId: "dev",
  role: "admin" as OrganizationRole,
}

/**
 * Require authentication with minimum role.
 *
 * @param minRole - Minimum role required (default: "member")
 */
export function requireAuth(minRole: OrganizationRole = "member"): MiddlewareHandler<GatewayContext> {
  return async (c, next) => {
    if (!Config.AUTH_ENABLED) {
      c.set("identity", DEV_IDENTITY)
      return next()
    }

    const identity = await resolveIdentity(c)

    if (!identity.ok) {
      return c.json({ error: identity.error }, identity.status)
    }

    if (!hasRole(identity.role, minRole)) {
      return c.json(
        {
          error: `Forbidden: requires ${minRole} role`,
          yourRole: identity.role,
        },
        403,
      )
    }

    c.set("identity", identity)
    await next()
  }
}

/**
 * Require workspace ownership.
 * User's organization must own the workspace.
 * FAILS CLOSED - if ownership cannot be verified, access is denied.
 */
export function requireWorkspaceAccess(): MiddlewareHandler<GatewayContext> {
  return async (c, next) => {
    if (!Config.AUTH_ENABLED) {
      c.set("identity", DEV_IDENTITY)
      return next()
    }

    const identity = await resolveIdentity(c)

    if (!identity.ok) {
      return c.json({ error: identity.error }, identity.status)
    }

    const workspaceId = c.req.param("workspaceId")
    if (workspaceId) {
      try {
        const workspaceOrgId = await resolveOrganizationIdForWorkspace(workspaceId)

        // FAIL CLOSED: If we can't determine ownership, deny access
        if (!workspaceOrgId) {
          return c.json({ error: "Cannot verify workspace ownership" }, 403)
        }

        if (workspaceOrgId !== identity.organizationId) {
          return c.json({ error: "Forbidden: workspace belongs to different organization" }, 403)
        }
      } catch (err: unknown) {
        // FAIL CLOSED: Any error in ownership check denies access
        const message = err instanceof Error ? err.message : "Unknown error"
        return c.json({ error: `Failed to verify workspace ownership: ${message}` }, 500)
      }
    }

    c.set("identity", identity)
    await next()
  }
}

/**
 * Get authenticated identity from context.
 * Throws if not authenticated (middleware not applied).
 */
export function getIdentity(c: Context<GatewayContext>): AuthenticatedIdentity {
  const identity = c.get("identity") as GatewayVariables["identity"]
  if (!identity?.ok) {
    throw new Error("Identity not available - auth middleware not applied?")
  }
  return identity
}
