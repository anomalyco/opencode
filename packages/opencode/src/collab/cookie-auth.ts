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
import { join } from "path"
import {
  CollabAuthSessionTable,
  CollabSessionTable,
  CollabParticipantTable,
} from "./schema.sql"

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

/** Extract a workspace-addressing parameter from a Request. */
function workspaceParamFrom(req: Request): string | null {
  const dirHeader = req.headers.get("x-opencode-directory")
  if (dirHeader) return dirHeader
  const url = new URL(req.url, "http://localhost")
  return (
    url.searchParams.get("directory") ||
    url.searchParams.get("location[directory]") ||
    null
  )
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
  return pathname.startsWith("/preview/")
}

export type CookieAuthDecision = "allow" | "deny" | "fallthrough"

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
 *                  proceeds to basic-auth validation.
 */
export function cookieAuthorizesRequest(req: Request): CookieAuthDecision {
  const id = lookupCookieIdentity(req)
  if (!id) return "fallthrough"

  const url = new URL(req.url, "http://localhost")

  // Rule (a): cookie-only paths (no scope check needed).
  if (cookieAllowedWithoutScope(url.pathname)) return "allow"

  // Rule (b): workspace-addressed routes — bind on directory.
  const dir = workspaceParamFrom(req)
  if (dir) {
    const sessionId = directoryToCollabSessionId(dir)
    if (!sessionId) return "deny"
    return participantOfSession(sessionId, id.githubId) ? "allow" : "deny"
  }

  // Rule (c): native-session-addressed routes — bind on Native Session ID.
  const nativeSessionId = nativeSessionIdFrom(req)
  if (nativeSessionId) {
    return participantOfNativeSession(nativeSessionId, id.githubId) ? "allow" : "deny"
  }

  // Rule (d): no addressing → fall through to basic-auth.  /global/event,
  // /global/config, /global/dispose, /global/upgrade etc. land here and
  // require the server credential.
  return "fallthrough"
}
