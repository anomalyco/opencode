import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { ForbiddenError } from "../errors.js"
import { isWebSocketUpgrade } from "./machine.js"

export const BROWSER_TUNNEL_PATH = "/api/experimental/browser/tunnel"
export const BROWSER_TUNNEL_TICKET_HEADER = "x-opencode-browser-ticket"
export const BROWSER_TUNNEL_SESSION_HEADER = "x-opencode-browser-session"
export const BROWSER_TUNNEL_CONNECTION_HEADER = "x-opencode-browser-connection"
export const BROWSER_TUNNEL_PROTOCOL_HEADER = "x-opencode-browser-protocol"
export const BROWSER_TUNNEL_PROTOCOL_VERSION = 1

/**
 * Whether a request targets the browser stream tunnel upgrade with a non-empty ticket header.
 * Compares the raw request path before any query string so URL normalization cannot alias another route.
 */
export function hasBrowserTunnelUpgrade(request: {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return (
    request.url.split("?", 1)[0] === BROWSER_TUNNEL_PATH &&
    isWebSocketUpgrade(request) &&
    !!request.headers[BROWSER_TUNNEL_TICKET_HEADER]?.trim()
  )
}

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const BrowserTunnelEndpoint = HttpApiEndpoint.get("browser.tunnel", BROWSER_TUNNEL_PATH, {
  success: Schema.Boolean,
  error: [ForbiddenError],
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.browser.tunnel",
    summary: "Open a browser attachment binary stream tunnel",
    description:
      "Upgrade to a binary WebSocket carrying multiplexed TCP streams for one live desktop browser attachment. Requires a short-lived, single-use attachment-bound ticket in the x-opencode-browser-ticket header minted through authenticated browser RPC. Never accepts a session ID or browser cookie alone. Experimental: may change without compatibility guarantees.",
    transform: (operation) => ({ ...operation, "x-websocket": true, tags: ["experimental"] }),
  }),
)
