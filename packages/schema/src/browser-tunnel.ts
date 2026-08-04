export * as BrowserTunnel from "./browser-tunnel.js"

import { Schema } from "effect"
import { Browser } from "./browser.js"
import { SessionID } from "./session-id.js"

export const Host = Schema.NonEmptyString.check(Schema.isMaxLength(253), Schema.isPattern(/^[^\s/?#]+$/))
  .pipe(Schema.brand("BrowserTunnel.Host"))
  .annotate({ identifier: "BrowserTunnel.Host" })
export type Host = typeof Host.Type

export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))
  .pipe(Schema.brand("BrowserTunnel.Port"))
  .annotate({ identifier: "BrowserTunnel.Port" })
export type Port = typeof Port.Type

export interface Target extends Schema.Schema.Type<typeof Target> {}
export const Target = Schema.Struct({
  host: Host,
  port: Port,
}).annotate({ identifier: "BrowserTunnel.Target" })

const Open = Schema.Struct({
  type: Schema.Literal("browser.tunnel.open"),
  sessionID: SessionID,
  leaseID: Browser.LeaseID,
  target: Target,
}).annotate({ identifier: "BrowserTunnel.Open" })

const Opened = Schema.Struct({
  type: Schema.Literal("browser.tunnel.opened"),
}).annotate({ identifier: "BrowserTunnel.Opened" })

export const OpenErrorCode = Schema.Literals([
  "invalid_open",
  "not_attached",
  "stale_lease",
  "connect_failed",
  "connect_timeout",
]).annotate({ identifier: "BrowserTunnel.OpenErrorCode" })
export type OpenErrorCode = typeof OpenErrorCode.Type

const Rejected = Schema.Struct({
  type: Schema.Literal("browser.tunnel.rejected"),
  code: OpenErrorCode,
  message: Schema.String.check(Schema.isMaxLength(1_024)),
}).annotate({ identifier: "BrowserTunnel.Rejected" })

export const FromClient = Open.annotate({ identifier: "BrowserTunnel.FromClient" })
export type FromClient = typeof FromClient.Type

export const FromServer = Schema.Union([Opened, Rejected])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "BrowserTunnel.FromServer" })
export type FromServer = typeof FromServer.Type
