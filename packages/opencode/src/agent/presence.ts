import { Schema } from "effect"
import { Loop } from "@/loop/loop"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"

export const Owner = Schema.Literal("opencode-skein")
export const Status = Schema.Literals(["idle", "busy", "awaiting-permission", "cancelling", "stalled", "unreachable"])
export type Status = Schema.Schema.Type<typeof Status>

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

export function statusFrom(input: {
  session: SessionStatus.Info | undefined
  permissionPending: boolean
  loop?: Loop.Info
}): Status {
  if (input.permissionPending) return "awaiting-permission"
  if (input.loop?.status === "stalled") return "stalled"
  if (input.loop?.status === "cancelled") return "cancelling"
  if (input.session?.type === "busy" || input.session?.type === "retry") return "busy"
  return "idle"
}

export function isActive(info: Info): boolean {
  return info.status !== "idle" || info.loopStatus === "paused"
}
