export * as TabStorage from "./schema"

import { Schema, SchemaGetter, Struct } from "effect"
import { ServerKey } from "@/runtime/server/persistence"
import { Persistence } from "@/runtime/persistence/schema"

export { ServerKey }

export const Session = Schema.Struct({
  type: Schema.Literal("session"),
  server: ServerKey,
  sessionId: Schema.String,
  routeSessionId: Persistence.defaulted(Schema.optional(Schema.String), () => undefined),
  routeParentId: Persistence.defaulted(Schema.optional(Schema.String), () => undefined),
}).mapFields(Struct.map(Schema.mutableKey))

export const Draft = Schema.Struct({
  type: Schema.Literal("draft"),
  draftID: Schema.String,
  server: ServerKey,
  directory: Schema.String,
  worktree: Persistence.defaulted(Schema.optional(Schema.String), () => undefined),
  branch: Persistence.defaulted(Schema.optional(Schema.String), () => undefined),
}).mapFields(Struct.map(Schema.mutableKey))

const SessionCodec = Session.pipe(
  Schema.decodeTo(Schema.toType(Session), {
    decode: SchemaGetter.transform((tab) => ({
      type: tab.type,
      server: tab.server,
      sessionId: tab.sessionId,
      ...(tab.routeSessionId && tab.routeSessionId !== tab.sessionId
        ? { routeSessionId: tab.routeSessionId, ...(tab.routeParentId ? { routeParentId: tab.routeParentId } : {}) }
        : {}),
    })),
    encode: SchemaGetter.transform((tab) => tab),
  }),
)

export const Tab = Schema.Union([Session, Draft])
export const Tabs = Persistence.array(Schema.Union([SessionCodec, Draft]))
export const Recent = Schema.Struct({
  key: Persistence.defaulted(Schema.UndefinedOr(Schema.String), () => undefined),
}).mapFields(Struct.map(Schema.mutableKey))
export const Info = Schema.Struct({
  title: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export const Infos = Schema.Record(Schema.String, Schema.mutableKey(Info))
export const Panes = Schema.Record(
  Schema.String,
  Schema.mutableKey(
    Schema.Struct({
      terminal: Schema.optional(Schema.Boolean),
      review: Schema.optional(Schema.Boolean),
      terminalHeight: Schema.optional(Schema.Finite),
      sessionWidth: Schema.optional(Schema.Finite),
    }).mapFields(Struct.map(Schema.mutableKey)),
  ),
)
export const ClosedTab = Schema.Struct({ tab: SessionCodec, index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
export const Closed = Persistence.array(ClosedTab)
