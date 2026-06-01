export * as SessionSchema from "./schema"

import { Schema } from "effect"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { RelativePath, optionalOmitUndefined, withStatics } from "../schema"
import { WorkspaceV2 } from "../workspace"
import { Identifier } from "../util/identifier"
import { V2Schema } from "../v2-schema"

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

export const LegacyInfo = Schema.Struct({
  id: ID,
  location: Location.Ref,
  subpath: RelativePath, // derived from location
  project: ProjectV2.ID, // derived from location
})
export type LegacyInfo = typeof LegacyInfo.Type

export class Info extends Schema.Class<Info>("Session.Info")({
  id: ID,
  parentID: optionalOmitUndefined(ID),
  projectID: ProjectV2.ID,
  workspaceID: optionalOmitUndefined(WorkspaceV2.ID),
  path: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
  model: ModelV2.Ref.pipe(optionalOmitUndefined),
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
    archived: optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis),
  }),
  title: Schema.String,
}) {}
