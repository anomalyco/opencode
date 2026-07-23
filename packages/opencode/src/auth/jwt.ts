import { Option, Schema } from "effect"

// Microsoft ID token claims we care about. JWT signature is NOT verified —
// trust comes from the Microsoft token endpoint during the OAuth exchange.
export interface JwtClaims {
  oid: string
  tid?: string
  preferred_username?: string
  name?: string
  roles?: readonly string[]
  groups?: readonly string[]
}

/**
 * Identity fields extracted from a Microsoft ID token JWT.
 * Maps Microsoft claims to our application-level identity fields:
 * - `preferred_username` → `email`
 * - `name` → `displayName`
 * - `tid` → `tenantId`
 *
 * Azure AD-specific fields:
 * - `roles` → App Roles array from `claims.roles`
 * - `groups` → Group IDs from `claims.groups`
 * - `extensionAttrs` → claims starting with `extn.` prefix, with the prefix stripped
 */
export interface IdentityFields {
  email?: string
  displayName?: string
  tenantId?: string
  roles?: readonly string[]
  groups?: readonly string[]
  extensionAttrs?: Record<string, string>
}

const JwtClaimsSchema = Schema.Struct({
  oid: Schema.String,
  tid: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  roles: Schema.optional(Schema.Array(Schema.String)),
  groups: Schema.optional(Schema.Array(Schema.String)),
})

function decodeBase64Url(segment: string): string | null {
  try {
    return Buffer.from(segment, "base64url").toString("utf8")
  } catch {
    return null
  }
}

/**
 * Decode a JWT without signature verification and extract identity claims.
 *
 * Returns `null` for non-JWT strings, parse errors, or missing `oid` claim.
 * The JWT was already validated by Microsoft during the OAuth exchange —
 * this helper only reads the claims, it does not establish trust.
 */
export function parseJwtClaims(token: string): JwtClaims | null {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length < 2) return null

  const payload = decodeBase64Url(parts[1])
  if (payload === null) return null

  let json: unknown
  try {
    json = JSON.parse(payload)
  } catch {
    return null
  }

  const decoded = Schema.decodeUnknownOption(JwtClaimsSchema)(json)
  return Option.isSome(decoded) ? decoded.value : null
}

/**
 * Extract identity fields from a Microsoft ID token JWT.
 *
 * Maps Microsoft Entra ID JWT claims to application-level identity fields:
 * - `preferred_username` → `email`
 * - `name` → `displayName`
 * - `tid` → `tenantId`
 *
 * Azure AD-specific fields:
 * - `roles` → App Roles array from `claims.roles`
 * - `groups` → Group IDs from `claims.groups`
 * - `extensionAttrs` → claims starting with `extn.` prefix, with the prefix stripped
 *   (e.g. `extn.monthlyTokenAllowance` → `{ monthlyTokenAllowance: "50000" }`)
 *
 * Returns `null` when the token is missing, malformed, or lacks the required
 * `oid` claim. Callers should continue with `accountId` only when null.
 */
export function extractIdentity(token: string | undefined): IdentityFields | null {
  if (!token) return null
  const claims = parseJwtClaims(token)
  if (!claims) return null

  // Parse raw payload for extension attributes (extn.* claims).
  const parts = token.split(".")
  const payload = decodeBase64Url(parts[1])
  let rawClaims: Record<string, unknown> = {}
  if (payload) {
    try {
      rawClaims = JSON.parse(payload)
    } catch {
      // Non-fatal — we still have the validated claims
    }
  }

  const extensionAttrs: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawClaims)) {
    if (key.startsWith("extn.") && typeof value === "string") {
      extensionAttrs[key.slice(5)] = value
    }
  }

  return {
    email: claims.preferred_username,
    displayName: claims.name,
    tenantId: claims.tid,
    ...(claims.roles && claims.roles.length > 0 ? { roles: claims.roles } : {}),
    ...(claims.groups && claims.groups.length > 0 ? { groups: claims.groups } : {}),
    ...(Object.keys(extensionAttrs).length > 0 ? { extensionAttrs } : {}),
  }
}
