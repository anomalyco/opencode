import { Schema } from "effect"
import { SessionSchema } from "../session/schema.js"

export const RecoverySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("shell"),
    sessionID: SessionSchema.ID,
    shellID: Schema.String,
    command: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("subagent"),
    parentSessionID: SessionSchema.ID,
    childSessionID: SessionSchema.ID,
    agent: Schema.String,
    description: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    sessionID: SessionSchema.ID,
    path: Schema.String,
    model: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("video"),
    sessionID: SessionSchema.ID,
    path: Schema.String,
    model: Schema.String,
    /** The provider's job token, plain JSON, so a restarted server can keep reading the same job. */
    token: Schema.Unknown,
  }),
])

export type Recovery = typeof RecoverySchema.Type
