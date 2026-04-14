import { z } from "zod"
import type { MessageEnvelope, MessageType, AgentID } from "./messages.js"

export const MessagePayloadSchema = z.object({
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const TaskPayloadSchema = z.object({
  task_id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["critical", "high", "normal", "low"]),
  deadline: z.number().optional(),
  parent_task_id: z.string().optional(),
  required_capabilities: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  context: z.string().optional(),
  budget: z.object({ max_tokens: z.number().optional(), max_cost: z.number().optional() }).optional(),
})

export const TaskResultPayloadSchema = z.object({
  task_id: z.string(),
  status: z.enum(["completed", "failed", "cancelled", "partial"]),
  summary: z.string(),
  files_modified: z.array(z.string()).optional(),
  files_created: z.array(z.string()).optional(),
  branch: z.string().optional(),
  error: z.string().optional(),
  tokens_used: z.object({ input: z.number(), output: z.number() }).optional(),
  cost: z.number().optional(),
  decisions: z
    .array(
      z.object({
        id: z.string(),
        timestamp: z.number(),
        summary: z.string(),
        rationale: z.string(),
        files_affected: z.array(z.string()).optional(),
        task_id: z.string().optional(),
      }),
    )
    .optional(),
})

export const TaskProgressPayloadSchema = z.object({
  task_id: z.string(),
  status: z.enum(["working", "waiting", "blocked"]),
  message: z.string(),
  progress_pct: z.number().min(0).max(100).optional(),
  files_modified_so_far: z.array(z.string()).optional(),
  tokens_used: z.object({ input: z.number(), output: z.number() }).optional(),
})

export const TaskCancelPayloadSchema = z.object({
  task_id: z.string(),
  reason: z.string().optional(),
})

export const DelegatePayloadSchema = z.object({
  task: TaskPayloadSchema,
  max_depth: z.number().positive(),
  return_to: z.string().min(1),
})

export const HandoffPayloadSchema = z.object({
  task_id: z.string(),
  reason: z.string(),
  progress: z.object({
    description: z.string(),
    files_modified: z.array(z.string()),
    files_created: z.array(z.string()),
    next_steps: z.array(z.string()).min(1),
    blockers: z.array(z.string()),
    git_branch: z.string().optional(),
    git_status: z.string().optional(),
  }),
  transfer_worktree: z.boolean(),
  worktree_path: z.string().optional(),
})

export const ShareRequestPayloadSchema = z.object({
  branch: z.string(),
  target_branch: z.string().optional(),
  description: z.string(),
  auto_merge: z.boolean(),
  files: z.array(z.string()).min(1),
  validation_command: z.string().optional(),
})

export const ShareResultPayloadSchema = z.object({
  request_id: z.string(),
  status: z.enum(["merged", "conflict", "validation_failed", "rejected"]),
  merge_commit: z.string().optional(),
  conflict_files: z.array(z.string()).optional(),
  validation_output: z.string().optional(),
})

export const ContextRequestPayloadSchema = z.object({
  query: z.string(),
  scope: z.enum(["team", "agent", "conversation"]),
  target_agent_id: z.string().optional(),
})

export const ContextResponsePayloadSchema = z.object({
  query: z.string(),
  result: z.string().min(1),
  source: z.object({
    agent: z.string(),
    files: z.array(z.string()).optional(),
    decisions: z
      .array(
        z.object({
          id: z.string(),
          timestamp: z.number(),
          summary: z.string(),
          rationale: z.string(),
          files_affected: z.array(z.string()).optional(),
          task_id: z.string().optional(),
        }),
      )
      .optional(),
  }),
})

export const AgentCapabilitiesSchema = z.object({
  tools: z.array(z.string()).default(["read", "glob", "grep", "list"]),
  read: z.boolean().default(true),
  write_own_workspace: z.boolean().default(true),
  share_to_team: z.boolean().default(false),
  delegate: z.boolean().default(true),
  spawn_subagents: z.boolean().default(false),
  max_delegation_depth: z.number().default(2),
  disk_quota_mb: z.number().default(500),
  protected_paths: z.array(z.string()).default([]),
})

export const AgentRegisterPayloadSchema = z.object({
  agent_id: z.string(),
  role: z.string().min(1),
  role_priority: z.number(),
  capabilities: AgentCapabilitiesSchema,
  model: z.object({ provider_id: z.string(), model_id: z.string() }).optional(),
  max_concurrent_tasks: z.number(),
  workspace_path: z.string(),
})

export const AgentHeartbeatPayloadSchema = z.object({
  agent_id: z.string(),
  status: z.enum(["idle", "busy", "waiting"]),
  current_task_id: z.string().optional(),
  memory_usage_mb: z.number().optional(),
  tokens_used_session: z.object({ input: z.number(), output: z.number() }).optional(),
})

export const ErrorPayloadSchema = z.object({
  message: z.string().min(1),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const DeadLetterPayloadSchema = z.object({
  reason: z.string(),
  original_envelope: z.any(),
})

export const MessageEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "message",
      "task",
      "task.result",
      "task.progress",
      "task.cancel",
      "delegate",
      "delegate.result",
      "handoff",
      "handoff.accepted",
      "share.request",
      "share.result",
      "context.request",
      "context.response",
      "disagreement",
      "agent.spawn",
      "agent.terminate",
      "agent.heartbeat",
      "agent.register",
      "agent.deregister",
      "agent.capability.query",
      "agent.list",
      "error",
      "dead_letter",
    ]),
    from: z.string().min(1),
    to: z.union([z.string().min(1), z.literal("broadcast")]),
    timestamp: z.number(),
    ttl: z.number().optional(),
    hop_count: z.number(),
    idempotency_key: z.string(),
    priority: z.enum(["critical", "high", "normal", "low"]),
    protocol_version: z.number(),
    correlation_id: z.string().optional(),
    payload: z.unknown(),
  })
  .passthrough()

export function validateMessage(raw: unknown): MessageEnvelope {
  return MessageEnvelopeSchema.parse(raw) as MessageEnvelope
}

export function generateIdempotencyKey(content: string, from: AgentID, type: MessageType): string {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(`${content}:${from}:${type}`)
  return hasher.digest("hex").slice(0, 16)
}

export function validateProtocolVersion(version: number): boolean {
  return version === 1
}
