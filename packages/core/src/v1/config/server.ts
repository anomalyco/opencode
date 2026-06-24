export * as ConfigServerV1 from "./server"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const EventStream = Schema.Struct({
  heartbeatMs: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1000, maximum: 60_000 }))).annotate({
    description: "Interval in milliseconds between SSE heartbeats (default: 10000)",
  }),
  idleTimeoutMs: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Close SSE connection after N ms without events (0 = disabled, default: 0)",
  }),
}).annotate({ identifier: "ServerEventStreamConfig" })

export const Server = Schema.Struct({
  port: Schema.optional(PositiveInt).annotate({
    description: "Port to listen on",
  }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: opencode.local)",
  }),
  cors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional domains to allow for CORS",
  }),
  eventStream: Schema.optional(EventStream).annotate({
    description: "Tune the global event SSE stream behavior to survive flaky networks",
  }),
}).annotate({ identifier: "ServerConfig" })
export type Server = Schema.Schema.Type<typeof Server>
