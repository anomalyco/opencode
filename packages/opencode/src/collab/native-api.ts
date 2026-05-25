/**
 * Authenticated wrapper around `fetch(localhost:4096/...)` for the collab
 * router's self-fetches into the native opencode HttpApi.
 *
 * After ADR-0001 the HttpApi refuses unauthenticated requests in production.
 * Two credential paths are supported:
 *
 *   1. Per-collab-session internal token (preferred — ADR-0001 Phase 3).
 *      Pass `collabSessionId` and the middleware short-circuits via the
 *      `x-opencode-internal-token` + `x-opencode-collab-session` header
 *      pair.  The token is process-local (see internal-token.ts).
 *
 *   2. Legacy shared basic-auth (`OPENCODE_SERVER_PASSWORD`).  Still
 *      attached when the env var is set, so non-collab `opencode serve`
 *      deployments keep working unchanged.
 *
 * Both headers are attached when both apply; the middleware accepts
 * whichever validates first.
 */

import { ServerAuth } from "@/server/auth"
import {
  INTERNAL_COLLAB_SESSION_HEADER,
  INTERNAL_TOKEN_HEADER,
  mintInternalToken,
} from "./internal-token"

const NATIVE_API_ORIGIN = "http://localhost:4096"

export type NativeFetchInit = RequestInit & {
  /**
   * Collab session that owns this self-call.  Pass it to enable the
   * per-session internal-token auth path; omit for context-free calls
   * (legacy basic-auth only).
   */
  collabSessionId?: string
}

export async function nativeFetch(path: string, init?: NativeFetchInit): Promise<Response> {
  const { collabSessionId, ...rest } = init ?? {}
  const headers = new Headers(rest.headers)

  if (collabSessionId) {
    const token = mintInternalToken(collabSessionId)
    if (!headers.has(INTERNAL_TOKEN_HEADER)) headers.set(INTERNAL_TOKEN_HEADER, token)
    if (!headers.has(INTERNAL_COLLAB_SESSION_HEADER))
      headers.set(INTERNAL_COLLAB_SESSION_HEADER, collabSessionId)
  }

  // Belt-and-braces: if a server password is still configured (e.g. a
  // mixed deployment where collab mode is on but the password also
  // exists), attach basic-auth too so the middleware has either path
  // available.  `ServerAuth.headers()` returns undefined when no password
  // is set, so this is a no-op in the utils deployment.
  const authHeaders = ServerAuth.headers()
  if (authHeaders) {
    for (const [k, v] of Object.entries(authHeaders)) {
      if (!headers.has(k)) headers.set(k, v)
    }
  }

  return fetch(NATIVE_API_ORIGIN + path, { ...rest, headers })
}
