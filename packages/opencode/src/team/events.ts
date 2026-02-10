import z from "zod"
import { BusEvent } from "../bus/bus-event"

export const MemberStatus = z.enum(["ready", "busy", "shutdown_requested", "shutdown", "error"])
export type MemberStatus = z.infer<typeof MemberStatus>

export const ExecutionStatus = z.enum([
  "idle",
  "starting",
  "running",
  "cancel_requested",
  "cancelling",
  "cancelled",
  "completing",
  "completed",
  "failed",
  "timed_out",
])
export type ExecutionStatus = z.infer<typeof ExecutionStatus>

/** Validates safe identifiers for team/member names — prevents path traversal */
const SafeName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Must be lowercase alphanumeric with hyphens, 1-64 chars")

export const TeamMemberSchema = z.object({
  name: SafeName,
  sessionID: z.string(),
  agent: z.string(),
  status: MemberStatus,
  execution_status: ExecutionStatus.optional(),
  prompt: z.string().optional(),
  /** Model this teammate is using, in "providerID/modelID" format. */
  model: z.string().optional(),
  planApproval: z.enum(["none", "pending", "approved", "rejected"]).optional(),
})
export type TeamMember = z.infer<typeof TeamMemberSchema>

export const TeamInfoSchema = z.object({
  name: SafeName,
  leadSessionID: z.string(),
  members: z.array(TeamMemberSchema),
  created: z.number(),
  delegate: z.boolean().optional(),
})
export type TeamInfo = z.infer<typeof TeamInfoSchema>

export const TeamTaskSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"]),
  priority: z.enum(["high", "medium", "low"]),
  assignee: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
})
export type TeamTask = z.infer<typeof TeamTaskSchema>

export namespace TeamEvent {
  export const Created = BusEvent.define(
    "team.created",
    z.object({
      team: TeamInfoSchema,
    }),
  )

  export const MemberSpawned = BusEvent.define(
    "team.member.spawned",
    z.object({
      teamName: z.string(),
      member: TeamMemberSchema,
    }),
  )

  export const MemberStatusChanged = BusEvent.define(
    "team.member.status",
    z.object({
      teamName: z.string(),
      memberName: z.string(),
      status: MemberStatus,
    }),
  )

  export const MemberExecutionChanged = BusEvent.define(
    "team.member.execution",
    z.object({
      teamName: z.string(),
      memberName: z.string(),
      status: ExecutionStatus,
    }),
  )

  export const Message = BusEvent.define(
    "team.message",
    z.object({
      teamName: z.string(),
      from: z.string(),
      to: z.string(),
      text: z.string(),
    }),
  )

  export const Broadcast = BusEvent.define(
    "team.broadcast",
    z.object({
      teamName: z.string(),
      from: z.string(),
      text: z.string(),
    }),
  )

  export const TaskUpdated = BusEvent.define(
    "team.task.updated",
    z.object({
      teamName: z.string(),
      tasks: z.array(TeamTaskSchema),
    }),
  )

  export const TaskClaimed = BusEvent.define(
    "team.task.claimed",
    z.object({
      teamName: z.string(),
      taskId: z.string(),
      memberName: z.string(),
    }),
  )

  export const ShutdownRequest = BusEvent.define(
    "team.shutdown.request",
    z.object({
      teamName: z.string(),
      memberName: z.string(),
    }),
  )

  export const PlanApproval = BusEvent.define(
    "team.plan.approval",
    z.object({
      teamName: z.string(),
      memberName: z.string(),
      approved: z.boolean(),
      feedback: z.string().optional(),
    }),
  )

  export const Cleaned = BusEvent.define(
    "team.cleaned",
    z.object({
      teamName: z.string(),
      leadSessionID: z.string(),
      delegate: z.boolean(),
    }),
  )
}
