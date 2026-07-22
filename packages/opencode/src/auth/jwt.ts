import { Option, Schema } from "effect"

// Microsoft ID token claims we care about. JWT signature is NOT verified —
// trust comes from the Microsoft token endpoint during the OAuth exchange.
export interface JwtClaims {
  oid: string
  tid?: string
  preferred_username?: string
  name?: string
}

/**
 * Identity fields extracted from a Microsoft ID token JWT.
 * Maps Microsoft claims to our application-level identity fields:
 * - `preferred_username` → `email`
 * - `name` → `displayName`
 * - `tid` → `tenantId`
 */
export interface IdentityFields {
  email?: string
  displayName?: string
  tenantId?: string
}

const JwtClaimsSchema = Schema.Struct({
  oid: Schema.String,
  tid: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
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
 * Returns `null` when the token is missing, malformed, or lacks the required
 * `oid` claim. Callers should continue with `accountId` only when null.
 */
export function extractIdentity(token: string | undefined): IdentityFields | null {
  if (!token) return null
  const claims = parseJwtClaims(token)
  if (!claims) return null
  return {
    email: claims.preferred_username,
    displayName: claims.name,
    tenantId: claims.tid,
  }
}
