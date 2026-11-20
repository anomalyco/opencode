import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"

export const MACHINE_LINK_PATH = "/api/experimental/machine/link"

/**
 * Whether a request asks to become a WebSocket, the one request the machine link serves and the one the server lets in
 * without its password: a GET with `Upgrade: websocket` and `upgrade` among its `Connection` tokens.
 */
export function isWebSocketUpgrade(request: {
  readonly method: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return (
    request.method === "GET" &&
    request.headers.upgrade?.toLowerCase() === "websocket" &&
    (request.headers.connection ?? "").split(",").some((token) => token.trim().toLowerCase() === "upgrade")
  )
}

/**
 * The same, for code that runs before the router has matched a route: the path is the request's own, up to its query,
 * compared as it was sent. A URL parser would resolve `..` and a leading `//host` to this path, and the router would not.
 */
export function isMachineLinkUpgrade(request: {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return request.url.split("?", 1)[0] === MACHINE_LINK_PATH && isWebSocketUpgrade(request)
}

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const MachineLinkEndpoint = HttpApiEndpoint.get("machine.link", MACHINE_LINK_PATH, {
  success: Schema.Boolean,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.machine.link",
    summary: "Connect a machine",
    description:
      "Upgrade to a WebSocket that carries a machine's link to this server: binary messages only, each at most 65,535 bytes. It takes no server password. The link's own handshake, which starts with the machine's first message, is the only way in: it admits a key this server has paired or a valid join string, and closes the socket on anything else without saying why. Behind the machines flag; without it the route does not exist. Experimental: may change without compatibility guarantees.",
    transform: (operation) => ({ ...operation, "x-websocket": true, tags: ["experimental"] }),
  }),
)
