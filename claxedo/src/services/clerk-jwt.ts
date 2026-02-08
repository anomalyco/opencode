/**
 * Clerk JWT parsing and verification utilities with per-request caching
 */
import { verifyToken } from "@clerk/backend"
import { Config } from "../config/index.ts"

export interface ClerkClaims {
  /** User ID (sub claim) */
  userId: string
  /** Organization ID (if in org context) */
  organizationId?: string
  /** Organization slug */
  organizationSlug?: string
  /** Organization role */
  organizationRole?: string
  /** Token expiration timestamp (seconds) */
  exp?: number
  /** Token issued at timestamp (seconds) */
  iat?: number
  /** Raw claims object */
  raw: Record<string, unknown>
}

// WeakMap for per-request caching (request object as key)
const claimsCache = new WeakMap<Request, ClerkClaims | null>()

// In-memory cache for standalone token verification (WebSocket)
const tokenCache = new Map<string, { claims: ClerkClaims | null; expiresAt: number }>()
const TOKEN_CACHE_TTL = 60 * 1000 // 1 minute

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization")
  if (!authHeader) return null

  const parts = authHeader.split(" ")
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null

  return parts[1]
}

/**
 * Verify and parse Clerk JWT with signature validation.
 * Uses @clerk/backend to verify against Clerk's JWKS.
 *
 * @param token - The JWT token to verify
 * @returns Verified claims or null if invalid
 */
export async function verifyClerkJwt(token: string): Promise<ClerkClaims | null> {
  // Check token cache first
  const cached = tokenCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.claims
  }

  const secretKey = Config.CLERK_SECRET_KEY
  if (!secretKey) {
    console.error("[clerk-jwt] CLERK_SECRET_KEY not configured - JWT verification disabled")
    // Fall back to parsing without verification in development
    if (!Config.isProduction) {
      return parseClerkJwtUnsafe(token)
    }
    return null
  }

  try {
    const payload = await verifyToken(token, {
      secretKey,
    })

    // Clerk uses org_id in custom templates, but o.id in default session tokens
    const orgObj = payload.o as { id?: string; slg?: string; rol?: string } | undefined
    const claims: ClerkClaims = {
      userId: payload.sub,
      organizationId: payload.org_id || orgObj?.id || undefined,
      organizationSlug: payload.org_slug || orgObj?.slg || undefined,
      organizationRole: payload.org_role || orgObj?.rol || undefined,
      exp: payload.exp,
      iat: payload.iat,
      raw: payload as unknown as Record<string, unknown>,
    }

    // Cache the verified token
    tokenCache.set(token, {
      claims,
      expiresAt: Date.now() + TOKEN_CACHE_TTL,
    })

    // Clean up expired entries periodically
    if (tokenCache.size > 1000) {
      const now = Date.now()
      for (const [key, value] of tokenCache) {
        if (value.expiresAt < now) {
          tokenCache.delete(key)
        }
      }
    }

    return claims
  } catch (err) {
    // Cache the failure briefly to avoid repeated verification attempts
    tokenCache.set(token, {
      claims: null,
      expiresAt: Date.now() + 5000, // 5 seconds for failures
    })
    return null
  }
}

/**
 * Parse Clerk JWT claims WITHOUT verification.
 * Only use in development or when verification happens elsewhere.
 *
 * @deprecated Use verifyClerkJwt() for production code
 */
export function parseClerkJwtUnsafe(token: string): ClerkClaims | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const payload = JSON.parse(atob(parts[1]))

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null
    }

    const userId = payload.sub
    if (!userId) return null

    return {
      userId,
      // Clerk uses org_id in custom templates, but o.id in default session tokens
      organizationId: payload.org_id || payload.orgId || payload.o?.id || undefined,
      organizationSlug: payload.org_slug || payload.orgSlug || payload.o?.slg || undefined,
      organizationRole: payload.org_role || payload.orgRole || payload.o?.rol || undefined,
      exp: payload.exp,
      iat: payload.iat,
      raw: payload,
    }
  } catch {
    return null
  }
}

/**
 * Parse Clerk JWT - alias for backward compatibility.
 * In production, use verifyClerkJwt() instead for proper verification.
 *
 * @deprecated Use verifyClerkJwt() for new code
 */
export function parseClerkJwt(token: string): ClerkClaims | null {
  // For synchronous contexts, use unsafe parsing
  // Callers should migrate to verifyClerkJwt()
  return parseClerkJwtUnsafe(token)
}

/**
 * Get verified Clerk claims from request with caching.
 * Returns cached result if already verified for this request.
 */
export async function getClerkClaimsVerified(request: Request): Promise<ClerkClaims | null> {
  // Check cache first
  if (claimsCache.has(request)) {
    return claimsCache.get(request) ?? null
  }

  // Extract and verify token
  const token = extractBearerToken(request.headers)
  if (!token) {
    claimsCache.set(request, null)
    return null
  }

  const claims = await verifyClerkJwt(token)
  claimsCache.set(request, claims)
  return claims
}

/**
 * Get Clerk claims from request with caching (synchronous, unverified).
 * Use getClerkClaimsVerified() for verified claims.
 *
 * @deprecated Use getClerkClaimsVerified() for production code
 */
export function getClerkClaims(request: Request): ClerkClaims | null {
  // Check cache first
  if (claimsCache.has(request)) {
    return claimsCache.get(request) ?? null
  }

  // Extract and parse token (unverified)
  const token = extractBearerToken(request.headers)
  if (!token) {
    claimsCache.set(request, null)
    return null
  }

  const claims = parseClerkJwtUnsafe(token)
  claimsCache.set(request, claims)
  return claims
}

/**
 * Get verified Clerk claims from Hono context with caching.
 */
export async function getClerkClaimsFromContextVerified(c: {
  req: { raw: Request }
}): Promise<ClerkClaims | null> {
  return getClerkClaimsVerified(c.req.raw)
}

/**
 * Get Clerk claims from Hono context with caching (synchronous, unverified).
 *
 * @deprecated Use getClerkClaimsFromContextVerified() for production code
 */
export function getClerkClaimsFromContext(c: { req: { raw: Request } }): ClerkClaims | null {
  return getClerkClaims(c.req.raw)
}
