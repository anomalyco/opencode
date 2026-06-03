export * as SessionSchema from "./schema"

import { Schema } from "effect"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { RelativePath, optionalOmitUndefined, withStatics } from "../schema"
import { Identifier } from "../util/identifier"
import { V2Schema } from "../v2-schema"
import { AgentV2 } from "../agent"

export const Delivery = Schema.Literals(["immediate", "deferred"]).annotate({
  identifier: "Session.Delivery",
})
export type Delivery = Schema.Schema.Type<typeof Delivery>

export const DefaultDelivery = "immediate" satisfies Delivery

export const ID = Schema.String.check(Schema.isStartsWith("ses")).pipe(
  Schema.brand("SessionID"),
  withStatics((schema) => ({
    descending: (id?: string) => schema.make(id ?? "ses_" + Identifier.descending()),
  })),
)
export type ID = typeof ID.Type

export class Info extends Schema.Class<Info>("SessionV2.Info")({
  id: ID,
  parentID: ID.pipe(optionalOmitUndefined),
  projectID: ProjectV2.ID,
  agent: AgentV2.ID.pipe(Schema.optional),
  model: ModelV2.Ref.pipe(Schema.optional),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    updated: V2Schema.DateTimeUtcFromMillis,
    archived: V2Schema.DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(Schema.optional),
}) {}
