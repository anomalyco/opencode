/**
 * Per-origin credential store for webfetch authentication.
 *
 * Provides the CredentialStore interface for pluggable storage backends,
 * three-tier URL matching (exact, origin, longest prefix), token refresh,
 * and credential resolution with auto-refresh.
 *
 * @see https://www.rfc-editor.org/rfc/rfc6750.html (Bearer tokens)
 * @see https://www.rfc-editor.org/rfc/rfc7617.html (Basic auth)
 */

import path from "path"
import { requireHttps, isLoopback, isPrivateNetwork, fetchASMetadata, type ASMetadata } from "./discovery"
import { tokenEndpointHeaders } from "./flow"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"

// ---------------------------------------------------------------------------
// CredentialStore interface
// ---------------------------------------------------------------------------

export interface CredentialStore {
  get(resource: string): Promise<Credential | undefined>
  set(resource: string, cred: Credential): Promise<void>
  remove(resource: string): Promise<void>
  all(): Promise<Record<string, Credential>>
}

// ---------------------------------------------------------------------------
// Credential types
// ---------------------------------------------------------------------------

export type Credential = {
  resource: string
  scheme: "bearer" | "basic"
  access_token?: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  username?: string
  password?: string
  oauth_client_id?: string
  oauth_client_secret?: string
  issuer?: string
}

// ---------------------------------------------------------------------------
// Three-tier URL matching — RFC 6750 protection space semantics
// ---------------------------------------------------------------------------

/**
 * Look up a stored credential for a resource URL using three-tier matching.
 *
 * Matching priority:
 * 1. Exact URL match
 * 2. Longest prefix match (path-segment-boundary-aware)
 * 3. Origin match
 *
 * @see https://www.rfc-editor.org/rfc/rfc6750.html#section-3 (scope of protection)
 */
export async function lookup(resource: string, store: CredentialStore): Promise<Credential | undefined> {
  const all = await store.all()
  const origin = new URL(resource).origin

  // Exact match first
  if (all[resource]) return all[resource]

  // Longest prefix match — origin-aware and path-segment-boundary-aware.
  // 1. Origins must match (prevents https://a.com matching https://a.com.evil.com)
  // 2. Key must end at a path boundary (prevents /v1 matching /v1extra)
  let best: Credential | undefined
  let len = 0
  for (const [key, cred] of Object.entries(all)) {
    if (key.length <= len || !resource.startsWith(key)) continue
    if (!URL.canParse(key) || new URL(key).origin !== origin) continue
    const next = resource[key.length]
    if (!next || next === "/" || next === "?" || next === "#") {
      best = cred
      len = key.length
    }
  }
  if (best) return best

  // Origin match is the broadest fallback.
  return all[origin]
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Check if a credential's access token has expired.
 * Uses a 30-second buffer before actual expiry to avoid edge cases
 * with clock skew and in-flight requests.
 */
export function expired(cred: Credential): boolean {
  if (!cred.expires_at) return false
  return Date.now() / 1000 > cred.expires_at - 30
}

/**
 * Build Authorization header value from a credential.
 *
 * RFC 6750 §2.1: Bearer token in Authorization header
 * RFC 7617 §2: Basic credentials as base64(user-id ":" password)
 *
 * Uses Buffer.from() for Basic auth to properly handle UTF-8 encoding
 * per RFC 7617 §2.1, unlike btoa() which throws on non-ASCII.
 */
export function headers(cred: Credential, logger: Log.Logger = Log.create({ service: "webfetch-auth" })): Record<string, string> {
  if (cred.scheme === "bearer" && cred.access_token) {
    // Defense-in-depth: reject tokens containing CR/LF characters.
    // Modern fetch() implementations reject CRLF in header values, but
    // this provides an additional layer against header injection.
    if (/[\r\n]/.test(cred.access_token)) {
      logger.error("access_token contains CR/LF, refusing to use", { resource: cred.resource })
      return {}
    }
    return { Authorization: `Bearer ${cred.access_token}` }
  }

  if (cred.scheme === "basic" && cred.username !== undefined && cred.password !== undefined) {
    // RFC 7617 §2: user-id MUST NOT contain ":" — it is used as the
    // separator and would corrupt the credential on the server side.
    if (cred.username.includes(":")) {
      logger.error("basic auth username must not contain ':'", { resource: cred.resource })
      return {}
    }
    // RFC 7617 §2: credentials = user-id ":" password, encoded as base64
    // Use Buffer for proper UTF-8 support (btoa throws on non-ASCII)
    const encoded = Buffer.from(`${cred.username}:${cred.password}`, "utf-8").toString("base64")
    return { Authorization: `Basic ${encoded}` }
  }

  return {}
}

// ---------------------------------------------------------------------------
// Token refresh — RFC 6749 §6
// ---------------------------------------------------------------------------

/**
 * Refresh an expired OAuth token using the refresh_token grant.
 *
 * Per RFC 6749 §6, the refresh request includes:
 * - grant_type=refresh_token
 * - refresh_token (REQUIRED)
 * - client_id (if the client is not authenticating via other means)
 *
 * @see https://www.rfc-editor.org/rfc/rfc6749.html#section-6
 */
export async function refresh(
  cred: Credential,
  metadata: ASMetadata,
  store: CredentialStore,
  logger: Log.Logger = Log.create({ service: "webfetch-auth" }),
  signal?: AbortSignal,
): Promise<Credential | undefined> {
  if (!cred.refresh_token || !metadata.token_endpoint) return undefined
  if (!requireHttps(metadata.token_endpoint)) return undefined

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cred.refresh_token,
  })
  // RFC 8707 §2.2: include resource parameter in refresh requests to
  // audience-restrict the new access token to the target resource.
  body.set("resource", cred.resource)
  const headers = cred.oauth_client_id
    ? tokenEndpointHeaders(
        metadata,
        {
          client_id: cred.oauth_client_id,
          client_secret: cred.oauth_client_secret,
        },
        body,
        logger,
      )
    : { "Content-Type": "application/x-www-form-urlencoded" }
  if (!headers) return undefined

  logger.info("refreshing token", { resource: cred.resource, issuer: cred.issuer })

  // redirect: "error" prevents a malicious AS from redirecting the refresh
  // POST to an internal service, leaking refresh tokens, client secrets,
  // and resource identifiers to the redirect target.
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers,
    redirect: "error",
    signal,
    body: body.toString(),
  }).catch(() => undefined)

  if (!response || !response.ok) {
    logger.error("token refresh failed", { status: response?.status, resource: cred.resource })
    return undefined
  }

  const tokens = (await response.json().catch(() => undefined)) as {
    access_token: string
    token_type?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  } | undefined

  if (!tokens || !tokens.access_token) return undefined

  // RFC 6749 §5.1: token_type is REQUIRED and MUST be "Bearer" (case-insensitive).
  // Consistent with the validation in flow.ts for initial token exchanges.
  if (!tokens.token_type || tokens.token_type.toLowerCase() !== "bearer") {
    logger.error("refresh token response missing or unsupported token_type", {
      type: tokens.token_type,
      resource: cred.resource,
    })
    return undefined
  }

  const updated: Credential = {
    ...cred,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? cred.refresh_token,
    expires_at: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
    scope: tokens.scope ?? cred.scope,
  }

  await store.set(cred.resource, updated)
  return updated
}

// ---------------------------------------------------------------------------
// Credential resolution — Layer 1
// ---------------------------------------------------------------------------

/**
 * Look up stored credentials for a URL and return auth headers.
 * Automatically refreshes expired tokens when a refresh_token is available.
 */
export async function resolveCredentials(
  url: string,
  store: CredentialStore,
  logger: Log.Logger = Log.create({ service: "webfetch-auth" }),
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const cred = await lookup(url, store).catch(() => undefined)
  if (!cred) return {}

  if (expired(cred) && cred.refresh_token && cred.issuer) {
    // SSRF protection: validate stored issuer before fetching AS metadata.
    // A malicious credential store entry could set issuer to a private IP
    // (e.g., "https://169.254.169.254") to probe internal services during
    // token refresh. Defense-in-depth — fetchASMetadata() also checks.
    const issuerUrl = requireHttps(cred.issuer)
    if (!issuerUrl) return {}
    if (!isLoopback(issuerUrl.hostname) && await isPrivateNetwork(issuerUrl.hostname)) {
      logger.error("stored issuer targets private network, skipping refresh", {
        resource: cred.resource,
        issuer: cred.issuer,
      })
      return {}
    }

    const as = await fetchASMetadata(cred.issuer, signal, { logger })
    if (as) {
      const refreshed = await refresh(cred, as, store, logger, signal)
      if (refreshed) return headers(refreshed, logger)
    }
  }

  if (!expired(cred)) return headers(cred, logger)
  return {}
}

// ---------------------------------------------------------------------------
// File-backed credential store — namespace pattern matching Auth/McpAuth
// ---------------------------------------------------------------------------

const filepath = path.join(Global.Path.data, "webfetch-auth.json")

async function load(): Promise<Record<string, Credential>> {
  return Filesystem.readJson<Record<string, Credential>>(filepath).catch(() => ({}))
}

export const store: CredentialStore = {
  async get(resource) {
    const data = await load()
    return data[resource]
  },
  async set(resource, cred) {
    const data = await load()
    await Filesystem.writeJson(filepath, { ...data, [resource]: cred }, 0o600)
  },
  async remove(resource) {
    const data = await load()
    delete data[resource]
    await Filesystem.writeJson(filepath, data, 0o600)
  },
  async all() {
    return load()
  },
}
