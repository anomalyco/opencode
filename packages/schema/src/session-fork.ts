export * as SessionFork from "./session-fork.js"

import { Schema } from "effect"
import { SessionMessage } from "./session-message.js"

export const Boundary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("before"), messageID: SessionMessage.ID }),
  Schema.Struct({ type: Schema.Literal("through"), messageID: SessionMessage.ID }),
]).annotate({ identifier: "Session.ForkBoundary" })
export type Boundary = typeof Boundary.Type

export const RequestBoundary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("before"), messageID: SessionMessage.ID }),
  Schema.Struct({ type: Schema.Literal("through") }),
]).annotate({ identifier: "Session.ForkRequestBoundary" })
export type RequestBoundary = typeof RequestBoundary.Type
