import { VideoID } from "@opencode/schema/generate"
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
  path: Schema.String,
})
const subagent = {
  kind: Schema.Literal("subagent"),
  childSessionID: SessionSchema.ID,
  agent: Schema.String,
  description: Schema.String,
}

const CodeMode = Schema.Struct({ kind: Schema.Literal("codemode"), sessionID: SessionSchema.ID, jobID: Schema.String })
export const OutstandingItem = Schema.Union([
  Shell,
  Image,
  Video,
  CodeMode,
  Schema.Struct({ ...subagent, sessionID: SessionSchema.ID }),
])
export type OutstandingItem = typeof OutstandingItem.Type

export const RecoverySchema = Schema.Union([
  CodeMode,
  Shell,
  Image,
  Schema.Struct({ ...Video.fields, videoID: VideoID }),
  Schema.Struct({
    ...subagent,
    parentSessionID: SessionSchema.ID,
    outstanding: Schema.optionalKey(Schema.Array(OutstandingItem)),
  }),
])

export type Recovery = typeof RecoverySchema.Type
