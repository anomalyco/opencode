export * as Session from "./session.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Location } from "./location.js"
import { Model } from "./model.js"
import { Project } from "./project.js"
import { DateTimeUtcFromMillis, optional, RelativePath } from "./schema.js"
import { SessionEvent } from "./session-event.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { Money } from "./money.js"
import { TokenUsage } from "./token-usage.js"
import { Revert } from "./session-revert.js"

export const ID = SessionID
export type ID = SessionID

export const Event = SessionEvent

export { Revert }

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  fork: Schema.Struct({
    sessionID: ID,
    /** Messages before this exclusive boundary are copied into the fork. */
    messageID: SessionMessage.ID.pipe(optional),
  }).pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Money.USD,
  tokens: TokenUsage.Info,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String,
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  revert: Revert.pipe(optional),
}).annotate({ identifier: "Session.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}
