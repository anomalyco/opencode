import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceEvent } from "@opencode/schema/service-event"
import { Session } from "@opencode/schema/session"
import { InvalidRequestError, UnauthorizedError } from "../errors.js"

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
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
    HttpApiEndpoint.get("server.connect", PAIRING_CONNECT_PATH, {
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
  .add(
    HttpApiEndpoint.post("server.restart.request", "/api/server/restart/request", {
      success: Schema.Struct({
        active: Schema.Array(Session.ID),
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.restart.request",
        summary: "Request service restart approval",
        description:
          "Register a pending service restart. Returns the sessions with running agents so the requester can seek approval. Resolving the request is reported through server.restart events.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.restart.resolve", "/api/server/restart/resolve", {
      payload: Schema.Struct({
        decision: ServiceEvent.Decision,
      }),
      success: Schema.Struct({
        decision: ServiceEvent.Decision,
      }),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.restart.resolve",
        summary: "Resolve pending service restart",
        description:
          "Approve the pending service restart (now or once sessions go idle) or cancel it. Only the first resolution wins.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
