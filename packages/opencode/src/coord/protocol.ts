import z from "zod"

const BaseMessage = z.object({
  from: z.string(),
  timestamp: z.string().datetime(),
  read: z.boolean().default(false),
})

export const MessageSchema = BaseMessage.extend({
  type: z.literal("message"),
  recipient: z.string(),
  content: z.string(),
  summary: z.string(),
})

export const BroadcastSchema = BaseMessage.extend({
  type: z.literal("broadcast"),
  content: z.string(),
  summary: z.string(),
})

export const ShutdownRequestSchema = BaseMessage.extend({
  type: z.literal("shutdown_request"),
  recipient: z.string(),
  requestId: z.string(),
  content: z.string().optional(),
})

export const ShutdownApprovedSchema = BaseMessage.extend({
  type: z.literal("shutdown_approved"),
  requestId: z.string(),
})

export const ShutdownRejectedSchema = BaseMessage.extend({
  type: z.literal("shutdown_rejected"),
  requestId: z.string(),
  content: z.string().optional(),
})

export const PlanApprovalRequestSchema = BaseMessage.extend({
  type: z.literal("plan_approval_request"),
  requestId: z.string(),
  planContent: z.string(),
})

export const PlanApprovalResponseSchema = BaseMessage.extend({
  type: z.literal("plan_approval_response"),
  requestId: z.string(),
  approved: z.boolean(),
  content: z.string().optional(),
})

export const IdleNotificationSchema = BaseMessage.extend({
  type: z.literal("idle_notification"),
  lastTaskId: z.string().optional(),
  peerSummary: z.string().optional(),
})

export const TaskAssignmentSchema = BaseMessage.extend({
  type: z.literal("task_assignment"),
  taskId: z.string(),
  recipient: z.string(),
})

export const TeammateTerminatedSchema = BaseMessage.extend({
  type: z.literal("teammate_terminated"),
  agentName: z.string(),
  reason: z.string().optional(),
})

export const PermissionRequestSchema = BaseMessage.extend({
  type: z.literal("permission_request"),
  requestId: z.string(),
  action: z.string(),
  details: z.string().optional(),
})

export const PermissionResponseSchema = BaseMessage.extend({
  type: z.literal("permission_response"),
  requestId: z.string(),
  granted: z.boolean(),
  reason: z.string().optional(),
})

export const SandboxPermissionRequestSchema = BaseMessage.extend({
  type: z.literal("sandbox_permission_request"),
  requestId: z.string(),
  command: z.string(),
  details: z.string().optional(),
})

export const SandboxPermissionResponseSchema = BaseMessage.extend({
  type: z.literal("sandbox_permission_response"),
  requestId: z.string(),
  granted: z.boolean(),
  reason: z.string().optional(),
})

export const Message = z.discriminatedUnion("type", [
  MessageSchema,
  BroadcastSchema,
  ShutdownRequestSchema,
  ShutdownApprovedSchema,
  ShutdownRejectedSchema,
  PlanApprovalRequestSchema,
  PlanApprovalResponseSchema,
  IdleNotificationSchema,
  TaskAssignmentSchema,
  TeammateTerminatedSchema,
  PermissionRequestSchema,
  PermissionResponseSchema,
  SandboxPermissionRequestSchema,
  SandboxPermissionResponseSchema,
]).meta({
  ref: "CoordMessage",
})

export type Message = z.infer<typeof Message>
export type MessageInput = DistributiveOmit<Message, "timestamp" | "read">

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

export const MessageInputSchema = z.discriminatedUnion("type", [
  MessageSchema.omit({ from: true, timestamp: true, read: true }),
  BroadcastSchema.omit({ from: true, timestamp: true, read: true }),
  ShutdownRequestSchema.omit({ from: true, timestamp: true, read: true }),
  ShutdownApprovedSchema.omit({ from: true, timestamp: true, read: true }),
  ShutdownRejectedSchema.omit({ from: true, timestamp: true, read: true }),
  PlanApprovalRequestSchema.omit({ from: true, timestamp: true, read: true }),
  PlanApprovalResponseSchema.omit({ from: true, timestamp: true, read: true }),
  IdleNotificationSchema.omit({ from: true, timestamp: true, read: true }),
  TaskAssignmentSchema.omit({ from: true, timestamp: true, read: true }),
  TeammateTerminatedSchema.omit({ from: true, timestamp: true, read: true }),
  PermissionRequestSchema.omit({ from: true, timestamp: true, read: true }),
  PermissionResponseSchema.omit({ from: true, timestamp: true, read: true }),
  SandboxPermissionRequestSchema.omit({ from: true, timestamp: true, read: true }),
  SandboxPermissionResponseSchema.omit({ from: true, timestamp: true, read: true }),
])

export function validate(input: unknown) {
  return Message.parse(input)
}

export function safeValidate(input: unknown) {
  const result = Message.safeParse(input)
  if (result.success) return result.data
  return
}

export function createMessage<T extends MessageInput>(input: T): T & { timestamp: string; read: boolean } {
  return {
    ...input,
    timestamp: new Date().toISOString(),
    read: false,
  }
}

export function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
