import { Schema } from "effect"
import { Loop } from "@/loop/loop"
import { SessionID } from "@/session/schema"
import { Status, statusFrom } from "./presence-status"

// Re-exported so the presence record reads as one thing; the derivation itself
// lives in a leaf module to keep session/peers.ts out of an import cycle.
export { Status, statusFrom }

export const Owner = Schema.Literal("opencode-skein")

export const Info = Schema.Struct({
  owner: Owner,
  instanceID: Schema.String,
  sessionID: SessionID,
  loopID: Schema.optional(Loop.LoopID),
  directory: Schema.String,
  agent: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  status: Status,
  loopStatus: Schema.optional(Loop.Status),
  loopIteration: Schema.optional(Schema.Int),
  lastEventAt: Schema.Finite,
  heartbeatAt: Schema.Finite,
  canPrompt: Schema.Boolean,
  canBtw: Schema.Boolean,
  canAbort: Schema.Boolean,
}).annotate({ identifier: "AgentPresence" })
export type Info = Schema.Schema.Type<typeof Info>

export function isActive(info: Info): boolean {
  return info.status !== "idle" || info.loopStatus === "paused"
}
