import { createHash, randomBytes } from "node:crypto"
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"
import type { ServerAuthConfig } from "./config"

type Metadata = {
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
}

type Cached = {
  metadata: Metadata
  jwks: ReturnType<typeof createRemoteJWKSet>
}

const cache = new Map<string, Promise<Cached>>()

export class OidcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OidcError"
  }
}

export type ClaimsIdentity = {
  issuer: string
  subject: string
  email?: string
  name?: string
  groups?: string[]
}

export function verifier() {
  return randomBytes(32).toString("base64url")
}

export function challenge(input: string) {
  return createHash("sha256").update(input).digest("base64url")
}

export function nonce() {
  return randomBytes(24).toString("base64url")
}

export function safeReturnTo(input: string | null | undefined) {
  if (!input) return "/"
  if (!input.startsWith("/") || input.startsWith("//")) return "/"
  return input
}

export async function metadata(config: ServerAuthConfig.Oidc) {
  const cached = cache.get(config.issuer)
  if (cached) return cached
  const next = fetch(`${config.issuer}/.well-known/openid-configuration`)
    .then(async (response) => {
      if (!response.ok) throw new OidcError(`failed to load OIDC discovery metadata: ${response.status}`)
      const body = (await response.json()) as Partial<Metadata>
      if (!body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri) {
        throw new OidcError("OIDC discovery metadata is missing required endpoints")
      }
      const metadata = {
        authorization_endpoint: body.authorization_endpoint,
        token_endpoint: body.token_endpoint,
        jwks_uri: body.jwks_uri,
        userinfo_endpoint: body.userinfo_endpoint,
        end_session_endpoint: body.end_session_endpoint,
      }
      return { metadata, jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)) }
    })
    .catch((error) => {
      cache.delete(config.issuer)
      throw error
    })
  cache.set(config.issuer, next)
  return next
}

export async function authorizationUrl(input: {
  config: ServerAuthConfig.Oidc
  redirectURI: string
  state: string
  nonce: string
  challenge: string
}) {
  const discovered = await metadata(input.config)
  const url = new URL(discovered.metadata.authorization_endpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", input.config.clientID)
  url.searchParams.set("redirect_uri", input.redirectURI)
  url.searchParams.set("scope", input.config.scopes.join(" "))
  url.searchParams.set("state", input.state)
  url.searchParams.set("nonce", input.nonce)
  url.searchParams.set("code_challenge", input.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url
}

export async function exchange(input: {
  config: ServerAuthConfig.Oidc
  code: string
  redirectURI: string
  verifier: string
}) {
  const discovered = await metadata(input.config)
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectURI,
    client_id: input.config.clientID,
    code_verifier: input.verifier,
  })
  if (input.config.clientSecret) body.set("client_secret", input.config.clientSecret)
  const response = await fetch(discovered.metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!response.ok) throw new OidcError(`OIDC token exchange failed: ${response.status}`)
  const token = (await response.json()) as { id_token?: string }
  if (!token.id_token) throw new OidcError("OIDC token response did not include an id_token")
  return token.id_token
}

export async function verifyIDToken(input: { config: ServerAuthConfig.Oidc; token: string; nonce: string }) {
  const discovered = await metadata(input.config)
  const result = await jwtVerify(input.token, discovered.jwks, {
    issuer: input.config.issuer,
    audience: input.config.clientID,
  })
  if (result.payload.nonce !== input.nonce) throw new OidcError("OIDC nonce did not match")
  return identity(input.config, result.payload)
}

export async function verifyBearerToken(config: ServerAuthConfig.Oidc, token: string) {
  const discovered = await metadata(config)
  const result = await jwtVerify(token, discovered.jwks, {
    issuer: config.issuer,
    audience: config.audience?.length ? config.audience : config.clientID,
  })
  return identity(config, result.payload)
}

function identity(config: ServerAuthConfig.Oidc, payload: JWTPayload): ClaimsIdentity {
  if (!payload.sub) throw new OidcError("OIDC token is missing subject")
  const email = typeof payload.email === "string" ? payload.email : undefined
  if (config.requireEmailVerified && payload.email_verified !== true) {
    throw new OidcError("OIDC email is not verified")
  }
  const groups = claimList(payload[config.groupsClaim])
  const allowed =
    config.allowedEmails.length === 0 && config.allowedDomains.length === 0 && config.allowedGroups.length === 0
      ? true
      : (email && config.allowedEmails.includes(email)) ||
        (email && config.allowedDomains.includes(email.split("@")[1] ?? "")) ||
        groups.some((group) => config.allowedGroups.includes(group))
  if (!allowed) throw new OidcError("OIDC identity is not allowed")
  const nameClaim = payload[config.usernameClaim]
  return {
    issuer: config.issuer,
    subject: payload.sub,
    email,
    name: typeof nameClaim === "string" ? nameClaim : typeof payload.name === "string" ? payload.name : undefined,
    groups,
  }
}

function claimList(input: unknown) {
  if (Array.isArray(input)) return input.filter((item): item is string => typeof item === "string")
  if (typeof input === "string") return input.split(/[ ,]+/).filter((item) => item.length > 0)
  return []
}

export * as ServerAuthOidc from "./oidc"
