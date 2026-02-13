/**
 * HTTP header utilities for proxy operations
 */

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/**
 * Remove hop-by-hop headers that should not be forwarded
 */
export function stripHopByHopHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const key of HOP_BY_HOP_HEADERS) {
    next.delete(key);
  }
  return next;
}

/**
 * Strip WebSocket client handshake headers
 * When creating a client WebSocket, it generates its own Sec-WebSocket-* headers.
 * Forwarding the browser's handshake headers can break the upstream handshake.
 */
export function stripWebSocketClientHandshakeHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const key of Array.from(next.keys())) {
    if (key.toLowerCase().startsWith("sec-websocket-")) {
      next.delete(key);
    }
  }
  // Host is derived from the URL by the client; passing it explicitly is unnecessary
  next.delete("host");
  return next;
}

/**
 * Add CORS headers for development mode
 */
export function withDevCors(req: Request, headers: Headers): Headers {
  const origin = req.headers.get("origin");
  if (!origin) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  const existingVary = headers.get("vary");
  headers.set("vary", existingVary ? `${existingVary}, Origin` : "Origin");
  return headers;
}

/**
 * Check if request is a WebSocket upgrade
 */
export function looksLikeWsUpgrade(req: Request): boolean {
  const upgrade = req.headers.get("upgrade");
  if (!upgrade) return false;
  return upgrade.toLowerCase() === "websocket";
}

/**
 * Convert HTTP URL to WebSocket URL
 */
export function toUpstreamWsUrl(httpUrl: string): string {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
