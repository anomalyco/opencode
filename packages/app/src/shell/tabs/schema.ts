export * as TabStorage from "./schema"

import { Schema, SchemaGetter } from "effect"
import { ServerKey } from "@/runtime/server/persistence"
import { Persistence } from "@/runtime/persistence/schema"

export { ServerKey }

export const Session = Persistence.struct({
  type: Schema.Literal("session"),
  server: ServerKey,
  sessionId: Schema.String,
  routeSessionId: Persistence.optional(Schema.String),
  routeParentId: Persistence.optional(Schema.String),
})

export const Draft = Persistence.struct({
  type: Schema.Literal("draft"),
  draftID: Schema.String,
  server: ServerKey,
  directory: Schema.String,
  worktree: Persistence.optional(Schema.String),
  branch: Persistence.optional(Schema.String),
  mcp: Persistence.optional(Persistence.struct({ target: Schema.String, states: Persistence.record(Schema.Boolean) })),
})

const SessionCodec = Session.pipe(
  Schema.decodeTo(Schema.toType(Session), {
    decode: SchemaGetter.transform(withRoute),
    encode: SchemaGetter.transform((tab) => tab),
  }),
)

export const Tab = Schema.Union([Session, Draft])

export const Tabs = Persistence.array(Schema.Union([SessionCodec, Draft]))

export const Recent = Persistence.struct({
  key: Schema.optional(Schema.String),
})

export const Info = Persistence.struct({
  title: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  prompted: Schema.optional(Schema.Boolean),
})

export const Infos = Schema.Record(Schema.String, Schema.mutableKey(Info))

// The dock and side regions keep the names they were stored under before extensions.
export const Regions = Schema.Record(
  Schema.String,
  Schema.mutableKey(
    Persistence.struct({
      dock: Schema.optional(Schema.Boolean),
      side: Schema.optional(Schema.Boolean),
      dockHeight: Schema.optional(Schema.Finite),
      sessionWidth: Schema.optional(Schema.Finite),
    }).pipe(Schema.encodeKeys({ dock: "terminal", side: "review", dockHeight: "terminalHeight" })),
  ),
)

export const ClosedTab = Persistence.struct({
  tab: SessionCodec,
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  info: Persistence.optional(Info),
})

export const Closed = Persistence.array(ClosedTab)

/** A tab keeps its route only when it differs from the session, and the route's parent only with the route. */
function withRoute(tab: typeof Session.Type) {
  const base = { type: tab.type, server: tab.server, sessionId: tab.sessionId }

  if (!tab.routeSessionId || tab.routeSessionId === tab.sessionId) return base

  const routed = { ...base, routeSessionId: tab.routeSessionId }

  return tab.routeParentId ? { ...routed, routeParentId: tab.routeParentId } : routed
}
