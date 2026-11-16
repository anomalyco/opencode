import { Schema } from "effect"
import { SessionSchema } from "../session/schema.js"

const Shell = Schema.Struct({
  kind: Schema.Literal("shell"),
  sessionID: SessionSchema.ID,
  shellID: Schema.String,
  command: Schema.String,
})
const Image = Schema.Struct({
  kind: Schema.Literal("image"),
  sessionID: SessionSchema.ID,
  path: Schema.String,
  model: Schema.String,
})
const Video = Schema.Struct({
  kind: Schema.Literal("video"),
  sessionID: SessionSchema.ID,
  /** The video's ID, which `GET /api/experimental/generate/video/:id` and its stored file use. */
  videoID: Schema.String,
  /** `providerID/modelID`. */
  model: Schema.String,
  /** The provider's job ID, so a restarted server keeps polling the same job instead of submitting again. */
  providerJobID: Schema.String,
})
const subagent = {
  kind: Schema.Literal("subagent"),
  childSessionID: SessionSchema.ID,
  agent: Schema.String,
  description: Schema.String,
}

const OutstandingItem = Schema.Union([Shell, Image, Schema.Struct({ ...subagent, sessionID: SessionSchema.ID })])
export type OutstandingItem = typeof OutstandingItem.Type

export const RecoverySchema = Schema.Union([
  Shell,
  Image,
  Video,
  Schema.Struct({
    ...subagent,
    parentSessionID: SessionSchema.ID,
    outstanding: Schema.optionalKey(Schema.Array(OutstandingItem)),
  }),
])

export type Recovery = typeof RecoverySchema.Type
