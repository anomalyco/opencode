import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"

// Refresh tokens rotate, so concurrent refreshes of the same token must share one request or the
// second gets invalid_grant and the stored credential is invalidated (session-wide needs_auth).
const refreshes = new Map<string, ReturnType<FetchLike>>()

const refreshKey = (url: string | URL, init: RequestInit | undefined) => {
  if (!(init?.body instanceof URLSearchParams) || init.body.get("grant_type") !== "refresh_token") return undefined
  return [String(url), init.body.get("client_id") ?? "", init.body.get("refresh_token") ?? ""].join("\u0000")
}

const base: FetchLike = fetch
const share = (pending: ReturnType<FetchLike>) => pending.then((response) => response.clone() as typeof response)

/** Single-flight fetch for MCP transports: concurrent OAuth refreshes of the same token share one
 * request. Wire this as the transport `fetch` so rotating refresh tokens survive parallel 401s. */
export const oauthFetch: FetchLike = (url, init) => {
  const key = refreshKey(url, init)
  if (key === undefined) return base(url, init)
  const current = refreshes.get(key)
  if (current) return share(current)
  const pending = base(url, init).finally(() => {
    if (refreshes.get(key) === pending) refreshes.delete(key)
  })
  refreshes.set(key, pending)
  return share(pending)
}
