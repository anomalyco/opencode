import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors.js"

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  urls: Schema.Array(Schema.String),
  paths: Schema.Struct({
    tmp: Schema.String,
    home: Schema.optionalKey(Schema.String),
  }),
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

const PAIRING_CONNECT_PATH = /^\/auth\/connect\/[^/]+$/

// Authorization middleware skips credential checks for pairing links; the connect handler consumes the code instead.
export function isPairingConnectURL(url: URL) {
  return PAIRING_CONNECT_PATH.test(url.pathname)
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
    HttpApiEndpoint.get("server.connect", "/auth/connect/:code", {
      params: { code: Schema.String },
      success: PairingSession,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.connect",
        summary: "Redeem pairing code",
        description:
          "Redeem a pairing code. Browsers receive a session cookie and a redirect to the web app; requests that accept JSON receive a session token to use as the password.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
