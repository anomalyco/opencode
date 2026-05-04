import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

// Fast-path unit tests live at `test/mcp/transport-error.test.ts`; they feed
// synthetic error objects into `isTransportError`. Whenever this classifier
// changes, also run `bun run test:mcp-probe` (test/mcp/transport-error-probe.mjs)
// to verify those synthetic shapes still match what real servers / sockets
// emit under `bun` and `node`.

const TRANSPORT_ERROR_CODES = new Set([
  // Node / Undici
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  // Bun (uses PascalCase identifiers on err.code)
  "ConnectionRefused",
  "ConnectionReset",
  "ConnectionAborted",
  "ConnectionClosed",
  "Timeout",
  "SocketClosed",
  "NotConnected",
  "FailedToOpenSocket",
])

export function isTransportError(e: unknown): boolean {
  if (e instanceof StreamableHTTPError) {
    // -1 = SDK protocol-level breakage (unexpected content-type, etc.)
    if (e.code === -1) return true
    if (typeof e.code !== "number") return false
    // 401/403 belong to auth flow, not transport
    if (e.code === 401 || e.code === 403) return false
    // Anything else 4xx (stale session 404, bad request 400, gone 410, ...) or 5xx counts
    return e.code >= 400
  }
  if (!(e instanceof Error)) return false
  const err = e as Error & { code?: string; cause?: { code?: string } }
  if (err.cause?.code && TRANSPORT_ERROR_CODES.has(err.cause.code)) return true
  if (err.code && TRANSPORT_ERROR_CODES.has(err.code)) return true
  if (err.message.includes("fetch failed")) return true
  if (err.message.includes("Unable to connect")) return true
  return false
}
