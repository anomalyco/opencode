export type AgentID = string

export const MessageType = {
  MESSAGE: "message",
  TASK: "task",
  TASK_RESULT: "task.result",
  TASK_PROGRESS: "task.progress",
  TASK_CANCEL: "task.cancel",
  DELEGATE: "delegate",
  DELEGATE_RESULT: "delegate.result",
  HANDOFF: "handoff",
  HANDOFF_ACCEPTED: "handoff.accepted",
  SHARE_REQUEST: "share.request",
  SHARE_RESULT: "share.result",
  CONTEXT_REQUEST: "context.request",
  CONTEXT_RESPONSE: "context.response",
  DISAGREEMENT: "disagreement",
  AGENT_SPAWN: "agent.spawn",
  AGENT_TERMINATE: "agent.terminate",
  AGENT_HEARTBEAT: "agent.heartbeat",
  AGENT_REGISTER: "agent.register",
  AGENT_DEREGISTER: "agent.deregister",
  AGENT_CAPABILITY_QUERY: "agent.capability.query",
  AGENT_LIST: "agent.list",
  ERROR: "error",
  DEAD_LETTER: "dead_letter",
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export type MessagePayload = {
  content: string
  metadata?: Record<string, unknown>
}

export type TaskPayload = {
  task_id: string
  title: string
  description: string
  priority: "critical" | "high" | "normal" | "low"
  deadline?: number
  parent_task_id?: string
  required_capabilities?: string[]
  files?: string[]
  context?: string
  budget?: { max_tokens?: number; max_cost?: number }
}

export type TaskResultPayload = {
  task_id: string
  status: "completed" | "failed" | "cancelled" | "partial"
  summary: string
  files_modified?: string[]
  files_created?: string[]
  branch?: string
  error?: string
  tokens_used?: { input: number; output: number }
  cost?: number
  decisions?: Decision[]
}

export type TaskProgressPayload = {
  task_id: string
  status: "working" | "waiting" | "blocked"
  message: string
  progress_pct?: number
  files_modified_so_far?: string[]
  tokens_used?: { input: number; output: number }
}

export type DelegatePayload = {
  task: TaskPayload
  max_depth: number
  return_to: AgentID
}

export type HandoffPayload = {
  task_id: string
  reason: string
  progress: {
    description: string
    files_modified: string[]
    files_created: string[]
    next_steps: string[]
    blockers: string[]
    git_branch?: string
    git_status?: string
  }
  transfer_worktree: boolean
  worktree_path?: string
}

export type ShareRequestPayload = {
  branch: string
  target_branch?: string
  description: string
  auto_merge: boolean
  files: string[]
  validation_command?: string
}

export type ShareResultPayload = {
  request_id: string
  status: "merged" | "conflict" | "validation_failed" | "rejected"
  merge_commit?: string
  conflict_files?: string[]
  validation_output?: string
}

export type ContextRequestPayload = {
  query: string
  scope: "team" | "agent" | "conversation"
  target_agent_id?: AgentID
}

export type ContextResponsePayload = {
  query: string
  result: string
  source: {
    agent: AgentID
    files?: string[]
    decisions?: Decision[]
  }
}

export type AgentRegisterPayload = {
  agent_id: AgentID
  role: string
  role_priority: number
  capabilities: AgentCapabilities
  model?: { provider_id: string; model_id: string }
  max_concurrent_tasks: number
  workspace_path: string
}

export type AgentHeartbeatPayload = {
  agent_id: AgentID
  status: "idle" | "busy" | "waiting"
  current_task_id?: string
  memory_usage_mb?: number
  tokens_used_session?: { input: number; output: number }
}

export type ErrorPayload = {
  message: string
  code?: string
  details?: Record<string, unknown>
}

export type DeadLetterPayload = {
  reason: string
  original_envelope: MessageEnvelope
}

export type AgentCapabilities = {
  tools: string[]
  read: boolean
  write_own_workspace: boolean
  share_to_team: boolean
  delegate: boolean
  spawn_subagents: boolean
  max_delegation_depth: number
  disk_quota_mb: number
  protected_paths: string[]
}

export type AgentStatus = "spawning" | "idle" | "busy" | "waiting" | "terminating" | "dead"

export type Decision = {
  id: string
  timestamp: number
  summary: string
  rationale: string
  files_affected?: string[]
  task_id?: string
}

export type AgentInfo = {
  id: AgentID
  role: string
  role_priority: number
  status: AgentStatus
  capabilities: AgentCapabilities
  model?: { provider_id: string; model_id: string }
  workspace_path: string
  current_task_id?: string
  session_id?: string
  pid?: number
  connected_at: number
  last_activity: number
  tokens_used: { input: number; output: number; total: number }
  cost_used: number
  disk_used_mb: number
  active_worktrees: string[]
  message_queue_size: number
}

export type PayloadMap = {
  message: MessagePayload
  task: TaskPayload
  "task.result": TaskResultPayload
  "task.progress": TaskProgressPayload
  "task.cancel": { task_id: string; reason?: string }
  delegate: DelegatePayload
  "delegate.result": TaskResultPayload
  handoff: HandoffPayload
  "handoff.accepted": { task_id: string; accepted_by: AgentID }
  "share.request": ShareRequestPayload
  "share.result": ShareResultPayload
  "context.request": ContextRequestPayload
  "context.response": ContextResponsePayload
  disagreement: { task_id: string; agents: AgentID[]; description: string }
  "agent.spawn": {
    agent_id?: AgentID
    role: string
    capabilities: Partial<AgentCapabilities>
    model?: { provider_id: string; model_id: string }
  }
  "agent.terminate": { agent_id: AgentID; reason: string; grace_period_ms?: number }
  "agent.heartbeat": AgentHeartbeatPayload
  "agent.register": AgentRegisterPayload
  "agent.deregister": { agent_id: AgentID; reason?: string }
  "agent.capability.query": { agent_id: AgentID }
  "agent.list": Record<string, never>
  error: ErrorPayload
  dead_letter: DeadLetterPayload
}

export type MessageEnvelope<T extends MessageType = MessageType> = {
  id: string
  type: T
  from: AgentID
  to: AgentID | "broadcast"
  timestamp: number
  ttl?: number
  hop_count: number
  idempotency_key: string
  priority: "critical" | "high" | "normal" | "low"
  protocol_version: number
  correlation_id?: string
  payload: PayloadMap[T]
}
