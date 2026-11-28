import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { UnauthorizedError } from "../errors.js"

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  // The machine's name, absent where the runtime has none (e.g. workerd).
  hostname: Schema.optional(Schema.String),
  urls: Schema.Array(Schema.String),
  paths: Schema.Struct({
    tmp: Schema.String,
  }),
  // Optional at every level so clients still decode servers that predate a capability.
  capabilities: Schema.optional(
    Schema.Struct({
      persistentPty: Schema.optional(Schema.Boolean),
    }),
  ),
}).annotate({ identifier: "ServerInfo" })
export type ServerInfo = typeof ServerInfo.Type

export const PairingCode = Schema.Struct({
  code: Schema.String,
  expires_in: Schema.Int,
}).annotate({ identifier: "PairingCode" })
export type PairingCode = typeof PairingCode.Type

export const PairingSession = Schema.Struct({
  token: Schema.String,
}).annotate({ identifier: "PairingSession" })
export type PairingSession = typeof PairingSession.Type

export const PAIRING_CONNECT_PATH = "/auth/connect/:code"

const PAIRING_CONNECT_URL = /^\/auth\/connect\/[^/]+$/

export function isPairingConnectURL(url: URL) {
  return PAIRING_CONNECT_URL.test(url.pathname)
}

export const ServerGroup = HttpApiGroup.make("server.server")
  .add(
    HttpApiEndpoint.get("server.info", "/api/info", {
      success: ServerInfo,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.info",
        summary: "Get server info",
        description: "Return the server identity, connection URLs, paths, and readiness status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.pair", "/api/pair", {
      success: PairingCode,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pair",
        summary: "Create pairing code",
        description: "Create a short-lived, single-use code for a /auth/connect/:code pairing link.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.connect", PAIRING_CONNECT_PATH, {
      params: { code: Schema.String },
      success: PairingSession,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.connect",
        summary: "Redeem pairing code",
        description:
          "Redeem a pairing code. Browsers submitting the pairing page receive a session cookie and a redirect to the web app; other clients receive a session token to use as the password.",
      }),
    ),
  )
  // Opening a link must not spend its code: link checkers, chat previews and HEAD probes fetch it before the user does.
  // Omitted from generated clients.
  .add(
    HttpApiEndpoint.get("server.connectPage", PAIRING_CONNECT_PATH, {
      params: { code: Schema.String },
      success: PairingSession,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.connectPage",
        summary: "Open pairing link",
        description:
          "Show browsers a page that redeems the pairing code when the user confirms; the code stays valid until then. Deprecated: a GET that does not ask for HTML still redeems the code for a session token, for clients built before POST. Removed in the next minor.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
