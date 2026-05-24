/**
 * Authenticated wrapper around `fetch(localhost:4096/...)` for the collab
 * router's self-fetches into the native opencode HttpApi.
 *
 * After ADR-0001 the HttpApi refuses unauthenticated requests in production
 * (when `OPENCODE_SERVER_PASSWORD` is set).  Self-fetches from the collab
 * executor are *server-internal* — they carry the server's basic-auth
 * credential, not any specific user's cookie.
 *
 * Use this helper instead of bare `fetch` for every call that targets a
 * native opencode endpoint from within this process.
 */

import { ServerAuth } from "@/server/auth"

const NATIVE_API_ORIGIN = "http://localhost:4096"

/**
 * Fetch a path on the local opencode HttpApi with the server's basic-auth
 * credential attached.  Pass-through everything else (method, body, etc.).
 *
 * In environments without `OPENCODE_SERVER_PASSWORD` (local dev with
 * `OPENCODE_ALLOW_UNAUTHENTICATED=1`) `ServerAuth.headers()` returns
 * undefined and the request goes out unauthenticated — same behaviour as
 * the gate when no password is configured.
 */
export async function nativeFetch(path: string, init?: RequestInit): Promise<Response> {
  const authHeaders = ServerAuth.headers()
  const headers = new Headers(init?.headers)
  if (authHeaders) {
    for (const [k, v] of Object.entries(authHeaders)) {
      // Don't clobber explicit overrides from the caller.
      if (!headers.has(k)) headers.set(k, v)
    }
  }
  return fetch(NATIVE_API_ORIGIN + path, { ...init, headers })
}
