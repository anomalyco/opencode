/**
 * Identity resolution and credential storage for Clerk auth
 */
import { getConvex } from "../clients/index.ts"
import { api } from "../../convex/_generated/api.js"
import { encrypt, getOrchestrator } from "../orchestrator/index.ts"
import { Config } from "../config/index.ts"
import { logJson, nowMs } from "../server/lib/logging.ts"
import { getClerkClaimsFromContextVerified, extractBearerToken } from "./clerk-jwt.ts"

import type { Identity, OrganizationRole } from "../server/types/roles.ts"

// Re-export for backward compatibility
export type ResolvedIdentity = Identity

/**
 * Resolve user identity from Clerk JWT in Authorization header.
 * Organization ID comes from JWT claims ONLY (set by Clerk).
 *
 * IMPORTANT: This function verifies JWT signatures in production.
 * Organization context must be in the JWT - no external overrides allowed.
 */
export async function resolveIdentity(c: { req: { raw: Request } }): Promise<Identity> {
  const t0 = nowMs()
  try {
    // Get verified claims from request
    const claims = await getClerkClaimsFromContextVerified(c)
    if (!claims) {
      return { ok: false, status: 401, error: "Unauthorized: Invalid or missing token" }
    }

    const token = extractBearerToken(c.req.raw.headers)!
    const userId = claims.userId

    // Get organization ID from JWT claims ONLY
    // Organization must be in the token - no external hints allowed for security
    const organizationId = claims.organizationId

    // Require organization context from JWT
    // Users must authenticate with an organization selected in Clerk
    if (!organizationId) {
      logJson("warn", {
        kind: "identity.no_org",
        userId,
        durationMs: nowMs() - t0,
      })
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Organization context required. Please select an organization.",
      }
    }

    // Extract role from Clerk JWT
    let role: OrganizationRole = "member"
    if (claims.organizationRole) {
      // Clerk roles: "org:admin" or "org:member" or just "admin"/"member"
      const clerkRole = claims.organizationRole.replace(/^org:/, "")
      if (clerkRole === "admin") role = "admin"
    }

    logJson("info", {
      kind: "identity.resolved",
      userId,
      organizationId,
      role,
      fromJwt: !!claims.organizationId,
      durationMs: nowMs() - t0,
    })

    return { ok: true, token, userId, organizationId, role }
  } catch (err: any) {
    logJson("error", { kind: "identity.failed", error: err?.message, durationMs: nowMs() - t0 })
    return { ok: false, status: 500, error: "Internal error resolving identity" }
  }
}

/**
 * Extract API key from auth payload
 */
export function extractApiKeyFromAuthPayload(body: any): string | null {
  if (!body || typeof body !== "object") return null
  if (body.type !== "api") return null
  if (typeof body.key !== "string") return null
  const key = body.key.trim()
  return key.length > 0 ? key : null
}

/**
 * Store provider credential in Convex and sync to sandboxes
 */
export async function storeProviderCredential(params: {
  providerID: string
  authPayload: any
  organizationId: string
}): Promise<boolean> {
  const key = extractApiKeyFromAuthPayload(params.authPayload)
  if (!key) return false

  const encryptionKey = Config.ENCRYPTION_KEY
  const encryptedKey = await encrypt(key, encryptionKey)

  await getConvex().mutation(api.aiCredentials.set, {
    organizationId: params.organizationId,
    provider: params.providerID,
    encryptedKey,
  })

  // Sync credential to any active sandboxes for this organization
  try {
    const orchestrator = getOrchestrator()
    await orchestrator.syncCredentialToSandboxes(params.organizationId, params.providerID, key)
  } catch {
    // Orchestrator may not be initialized (e.g., cloud mode not enabled)
  }

  return true
}

