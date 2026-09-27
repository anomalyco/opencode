export * as Artifact from "./artifact"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { ProjectID } from "./project-id"
import { SessionID } from "./session-id"
import { PositiveInt, optional, statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("art_")).pipe(
  Schema.brand("Artifact.ID"),
  statics((schema) => ({ create: () => schema.make("art_" + ascending()) })),
)
export type ID = typeof ID.Type

export const CommentID = Schema.String.check(Schema.isStartsWith("cmt_")).pipe(
  Schema.brand("Artifact.CommentID"),
  statics((schema) => ({ create: () => schema.make("cmt_" + ascending()) })),
)
export type CommentID = typeof CommentID.Type

/** The thirteen first-class artifact kinds. Closed set: every value comes from the artifact specification. */
export const Type = Schema.Literals([
  "PLAN",
  "ARCHITECTURE",
  "CODE_DIFF",
  "TEST_RESULT",
  "BROWSER_RECORDING",
  "SCREENSHOT",
  "LOG",
  "SECURITY_REPORT",
  "PERFORMANCE_REPORT",
  "DATABASE_REPORT",
  "BUILD_REPORT",
  "DEPLOY_REPORT",
  "FINAL_WALKTHROUGH",
]).annotate({ identifier: "Artifact.Type" })
export type Type = typeof Type.Type

/** Review lifecycle of an artifact: created as draft, marked ready once complete, then approved or rejected before archival. */
export const Status = Schema.Literals(["draft", "ready", "approved", "rejected", "archived"]).annotate({
  identifier: "Artifact.Status",
})
export type Status = typeof Status.Type

/** A human comment attached directly to an artifact. When the artifact is linked to a session, the comment is steered back to the responsible agent as actionable context. */
export interface Comment extends Schema.Schema.Type<typeof Comment> {}
export const Comment = Schema.Struct({
  id: CommentID,
  author: Schema.String,
  body: Schema.String,
  timeCreated: Schema.Number,
}).annotate({ identifier: "Artifact.Comment" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  projectID: ProjectID,
  sessionID: optional(SessionID),
  name: Schema.String,
  type: Type,
  status: Status,
  version: PositiveInt,
  agent: optional(Schema.String),
  task: optional(Schema.String),
  content: Schema.String,
  diff: optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
  comments: Schema.Array(Comment),
}).annotate({ identifier: "Artifact.Info" })
