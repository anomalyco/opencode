import { Option, Schema } from "effect"

// Microsoft ID token claims we care about. JWT signature is NOT verified —
// trust comes from the Microsoft token endpoint during the OAuth exchange.
export interface JwtClaims {
  oid: string
  tid?: string
  preferred_username?: string
  name?: string
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
