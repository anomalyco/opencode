/**
 * Cookie-based auth helper for the unified auth gate.
 *
 * The deploy is protected by two credential types:
 *
 *  1. `collab_sid` cookie (set by the OAuth flow).  Identifies a GitHub
 *     org member.  Scoped — see `cookieAuthorizesRequest` below.
 *  2. Basic auth (`OPENCODE_SERVER_PASSWORD`).  Identifies the server
 *     itself.  Used for internal self-fetches via `nativeFetch`.
 *
 * `cookieAuthorizesRequest` is the 3-rule decision function called from
 * both auth middlewares (the HttpApi-layer `validateCredential` and the
 * router-layer `validateRawCredential`) and from the `/preview/<port>/*`
 * proxy gate.  The middleware checks `isPublicUIPath` first; the cookie
 * helper is consulted next; basic auth is the fallthrough.
 *
 * See CONTEXT.md → "Cookie Authorization Scope" for the design.
 * See docs/adr/0001 (preview proxy auth) for the trigger.
 */

import { Database } from "@/storage/db"
import { eq, and, isNull } from "drizzle-orm"
import { base64Decode } from "@opencode-ai/core/util/encode"
import {
  CollabAuthSessionTable,
  CollabSessionTable,
  CollabParticipantTable,
  CollabRepoTable,
} from "./schema.sql"

// NOTE: the auth gate only needs the cookie holder's identity
// (github_id, github_login) for the participation check.  The encrypted
// github_access_token column is read & decrypted only in router.ts's
// getSession(), which is where the decrypt-failure-then-delete policy
// lives.  Don't import crypto here — keeping the auth-gate path
// independent of SESSION_SECRET availability avoids accidental coupling.

/**
 * Parse a `Cookie:` header into a key→value map.  Single source of truth so
 * the WebSocket upgrade path doesn't have to re-implement it.
 */
export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k) out[k.trim()] = decodeURIComponent(v.join("="))
  }
  return out
}

/** Container workspace root.  Mirrors collab/workspace.ts. */
function workspaceRoot(): string {
  return process.env["COLLAB_WORKSPACE_ROOT"] ?? "/var/opencode/workspaces"
}

/**
 * Resolve a workspace-addressing string (header `x-opencode-directory` or
 * query `directory=` / `location[directory]=`) to a collab session id.
 *
 * The workspace path is computed as `<root>/<collabSessionId>/<repoName?>/`,
 * so the first path component after the root IS the collab session id.
 * Returns null for paths outside the workspace root (e.g. opencode's
 * own source tree during dev) — those won't pass the participation check
 * by definition.
 */
export function directoryToCollabSessionId(dir: string): string | null {
  const root = workspaceRoot()
  // Strip a trailing slash on root once so the prefix check is exact.
  const rootWithSlash = root.endsWith("/") ? root : root + "/"
  if (!dir.startsWith(rootWithSlash)) return null
  const rest = dir.slice(rootWithSlash.length)
  const sessionId = rest.split("/")[0]
  return sessionId || null
}

/**
 * Minimal info the auth gate needs about the cookie holder.
 */
export interface CookieIdentity {
  readonly token: string
  readonly githubId: number
  readonly githubLogin: string
}

/**
 * Look up the auth session row for a cookie token.  Returns null when the
 * cookie is missing, unknown, or expired.  Mirrors the opportunistic-delete
 * pattern from getSession() in router.ts.
 */
export function lookupCookieIdentity(req: Request): CookieIdentity | null {
  const sid = parseCookies(req.headers.get("cookie") ?? "")["collab_sid"]
  if (!sid) return null
  return Database.use((db) => {
    const row = db
      .select()
      .from(CollabAuthSessionTable)
      .where(eq(CollabAuthSessionTable.token, sid))
      .get()
    if (!row) return null
    if (row.expires_at < Date.now()) {
      db.delete(CollabAuthSessionTable).where(eq(CollabAuthSessionTable.token, sid)).run()
      return null
    }
    return { token: sid, githubId: row.github_id, githubLogin: row.github_login }
  })
}

/** Same lookup but takes a parsed cookies map directly — used by the
 *  Node-side WebSocket upgrade path where we don't have a `Request`. */
export function lookupCookieIdentityFromHeaders(cookieHeader: string): CookieIdentity | null {
  const sid = parseCookies(cookieHeader)["collab_sid"]
  if (!sid) return null
  return Database.use((db) => {
    const row = db
      .select()
      .from(CollabAuthSessionTable)
      .where(eq(CollabAuthSessionTable.token, sid))
      .get()
    if (!row) return null
    if (row.expires_at < Date.now()) {
      db.delete(CollabAuthSessionTable).where(eq(CollabAuthSessionTable.token, sid)).run()
      return null
    }
    return { token: sid, githubId: row.github_id, githubLogin: row.github_login }
  })
}

/**
 * Is the cookie holder a participant of the collab session with this id?
 * One indexed SQLite read.
 */
function participantOfSession(collabSessionId: string, githubId: number): boolean {
  return Database.use((db) => {
    const row = db
      .select({ id: CollabSessionTable.id })
      .from(CollabSessionTable)
      .innerJoin(
        CollabParticipantTable,
        eq(CollabParticipantTable.collab_session_id, CollabSessionTable.id),
      )
      .where(
        and(
          eq(CollabSessionTable.id, collabSessionId),
          eq(CollabParticipantTable.github_id, githubId),
          isNull(CollabSessionTable.deleted_at),
        ),
      )
      .get()
    return !!row
  })
}

/**
 * Is the cookie holder a participant of the collab session whose Native
 * Session ID is the given value?
 */
function participantOfNativeSession(nativeSessionId: string, githubId: number): boolean {
  return Database.use((db) => {
    const row = db
      .select({ id: CollabSessionTable.id })
      .from(CollabSessionTable)
      .innerJoin(
        CollabParticipantTable,
        eq(CollabParticipantTable.collab_session_id, CollabSessionTable.id),
      )
      .where(
        and(
          eq(CollabSessionTable.session_id, nativeSessionId),
          eq(CollabParticipantTable.github_id, githubId),
          isNull(CollabSessionTable.deleted_at),
        ),
      )
      .get()
    return !!row
  })
}

/** Extract a workspace-addressing parameter from a Request.
 *
 *  The iframe URL shape is `/<base64(workspaceDirectory)>/session/<sid>?cs=<csid>`
 *  — the directory is encoded in the first path segment, not in
 *  `?directory=` or `x-opencode-directory`.  Without this third lookup,
 *  cookie-auth's rule (b) misses the iframe entirely → fallthrough → 302
 *  to OAuth → CSP-blocked because iframes can't navigate to github.com.
 *
 *  base64Decode here mirrors packages/app/src/utils/base64.ts which is
 *  what the SPA uses to construct the URL — URL-safe base64 (`-`/`_` in
 *  place of `+`/`/`, no padding).
 *
 *  The `x-opencode-directory` header arrives URL-encoded — the SDK sets
 *  it to `encodeURIComponent(directory)` in packages/sdk/js/src/v2/client.ts.
 *  For GET/HEAD the SDK's rewrite interceptor moves it into a `?directory=`
 *  query param (which the server decodes via URLSearchParams), but for
 *  POST/DELETE/PATCH the encoded header reaches us as-is.  Decoding here
 *  makes the gate behave consistently across methods; decodeURIComponent
 *  on an already-raw path is a no-op (no percent sequences).
 *
 *  Query params and the base64 path segment are decoded by their own
 *  parsers (`searchParams.get()` percent-decodes; `base64Decode` returns
 *  bytes interpreted as UTF-8) so they don't need this normalisation.
 */
export function workspaceParamFrom(req: Request): string | null {
  const dirHeader = req.headers.get("x-opencode-directory")
  if (dirHeader) return safeDecodeURIComponent(dirHeader)
  const url = new URL(req.url, "http://localhost")
  const queryDir = url.searchParams.get("directory") || url.searchParams.get("location[directory]")
  if (queryDir) return queryDir
  return directoryFromBase64Path(url.pathname)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // Malformed percent-encoding — fall back to the raw value so the
    // caller still gets a chance at the prefix check.  Either it'll match
    // (raw path that happened to contain a stray %) or it won't (in which
    // case rule (b) denies, same as before).
    return value
  }
}

function directoryFromBase64Path(pathname: string): string | null {
  // First path segment, e.g. /<base64>/session/... → "<base64>".
  const first = pathname.split("/", 2)[1]
  if (!first) return null
  // URL-safe base64 alphabet: [A-Za-z0-9_-].  Anything else (digits-only,
  // dotted, etc.) is not a directory-encoded path.
  if (!/^[A-Za-z0-9_-]+$/.test(first)) return null
  try {
    const decoded = base64Decode(first)
    // Decoded value must look like an absolute filesystem path.
    if (decoded.startsWith("/")) return decoded
  } catch {
    // Not base64 — fall through.
  }
  return null
}

/**
 * Extract a native session id from common URL shapes.  Currently we only
 * detect the `/event/<sessionId>` and `/session/<sessionId>/...` patterns
 * — those are the routes that don't carry `x-opencode-directory` but DO
 * scope to a specific Native Session.
 */
function nativeSessionIdFrom(req: Request): string | null {
  const url = new URL(req.url, "http://localhost")
  const m = url.pathname.match(/^\/(?:event|session)\/([^/]+)/)
  return m ? m[1]! : null
}

/** Paths for which a valid cookie alone (no scope check) is enough. */
function cookieAllowedWithoutScope(pathname: string): boolean {
  // /preview/<port>/* — see ADR-0001 + the inline note in preview-router.ts:
  // participants already have shell-level trust via the iframe terminal, so
  // strict port↔session binding is deferred to v2.
  if (pathname.startsWith("/preview/")) return true

  // SPA bootstrap endpoints used by GlobalSyncProvider on every route
  // (including /collab/*).  None of them are workspace-scoped — they
  // describe the running opencode binary or the user's global config.
  // Any authenticated unleashlive org member may read them.  Without this
  // they fail cookie-auth's scope check, fall through to "deny" in collab
  // mode, and the SPA's GlobalSyncProvider thrashes with 401s.
  //
  // Explicitly listed (not a prefix) so future per-workspace HttpApi groups
  // mounted under e.g. /provider/<id>/... wouldn't accidentally inherit the
  // unscoped pass.
  const UNSCOPED_SPA_BOOTSTRAP = new Set([
    "/global/event",
    "/global/config",
    "/path",
    "/project",
    "/provider",
    // The provider auth-methods endpoint is loaded by the connect-provider
    // dialog before any workspace context is known (e.g. when the user opens
    // the model-selection dropdown during collab).  Without this entry the
    // cookie-auth scope check falls through to "deny" in collab mode and the
    // dialog receives a 401 before the user can pick an auth method.
    "/provider/auth",
  ])
  if (UNSCOPED_SPA_BOOTSTRAP.has(pathname)) return true

  return false
}

export type CookieAuthDecision = "allow" | "deny" | "fallthrough"

/**
 * Auth mode.  Driven by OPENCODE_AUTH_MODE env:
 *   - "collab" → OAuth-cookie is the sole gate; basic-auth is disabled.
 *                Fallthrough decisions become "deny" so unauthenticated
 *                requests don't escape into the basic-auth path.
 *   - else    → cookie-OR-basic.  Fallthrough hands off to basic-auth.
 *
 * Read at request time so a redeploy can flip mode without code change.
 */
export function authMode(): "collab" | "basic" {
  return process.env["OPENCODE_AUTH_MODE"] === "collab" ? "collab" : "basic"
}

/**
 * 3-rule decision function — see CONTEXT.md → Cookie Authorization Scope.
 *
 * - `"allow"`   — cookie present, valid, scoped to this resource.  Caller
 *                  serves the request.
 * - `"deny"`    — cookie present, valid, but NOT scoped to this resource.
 *                  Caller MUST 401 immediately; do not fall through to
 *                  basic-auth (avoids signalling the password's existence
 *                  in response to a scoped-cookie miss).
 * - `"fallthrough"` — no cookie at all (or invalid/expired).  Caller
 *                  proceeds to basic-auth validation, EXCEPT in collab
 *                  mode where the caller MUST treat fallthrough as deny.
 */
export function cookieAuthorizesRequest(req: Request): CookieAuthDecision {
  const id = lookupCookieIdentity(req)
  if (!id) return "fallthrough"

  const url = new URL(req.url, "http://localhost")

  // Rule (a): cookie-only paths (no scope check needed).
  if (cookieAllowedWithoutScope(url.pathname)) return "allow"

  // Rule (b): workspace-addressed routes — bind on directory + repos > 0.
  const dir = workspaceParamFrom(req)
  if (dir) {
    const sessionId = directoryToCollabSessionId(dir)
    if (!sessionId) return "deny"
    if (!participantOfSession(sessionId, id.githubId)) return "deny"
    // Iframe-gate: a workspace-scoped request to a collab session that has
    // no linked repos must be denied (matches the "iframe only after OAuth
    // AND repository selection" requirement — the SPA renders a fallback
    // panel at /collab/<id> in that case).
    return sessionHasRepos(sessionId) ? "allow" : "deny"
  }

  // Rule (c): native-session-addressed routes — bind on Native Session ID
  // + repos > 0 (same iframe-gate rationale as (b)).
  const nativeSessionId = nativeSessionIdFrom(req)
  if (nativeSessionId) {
    if (!participantOfNativeSession(nativeSessionId, id.githubId)) return "deny"
    return nativeSessionHasRepos(nativeSessionId) ? "allow" : "deny"
  }

  // Rule (d): no addressing → fall through.  /global/event, /global/config,
  // /global/dispose, /global/upgrade etc. land here.  In basic-mode this
  // hands off to basic-auth (server-internal callers).  In collab-mode the
  // caller treats fallthrough as deny — there should be no unscoped HttpApi
  // access without a workspace context when collab gates everything.
  return "fallthrough"
}

/** Does a collab session have at least one linked repo? */
function sessionHasRepos(collabSessionId: string): boolean {
  return Database.use((db) => {
    const row = db
      .select({ id: CollabRepoTable.id })
      .from(CollabRepoTable)
      .where(eq(CollabRepoTable.collab_session_id, collabSessionId))
      .get()
    return !!row
  })
}

/** Does the collab session bound to this Native Session ID have repos? */
function nativeSessionHasRepos(nativeSessionId: string): boolean {
  return Database.use((db) => {
    const row = db
      .select({ id: CollabRepoTable.id })
      .from(CollabRepoTable)
      .innerJoin(
        CollabSessionTable,
        eq(CollabRepoTable.collab_session_id, CollabSessionTable.id),
      )
      .where(eq(CollabSessionTable.session_id, nativeSessionId))
      .get()
    return !!row
  })
}
