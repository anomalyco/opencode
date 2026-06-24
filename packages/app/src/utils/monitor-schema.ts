/**
 * Local mirror of the opencode monitor zod schemas.
 *
 * The monitor module ships with its schemas inside the opencode package
 * (see `packages/opencode/src/monitor/{health,kanban,…}.ts`). The app
 * workspace does not depend on `@opencode-ai/opencode` directly — it only
 * depends on `@opencode-ai/sdk`, `-ui`, `-shared` — so we mirror the
 * shape here. Keep this file in lock-step with the opencode sources;
 * the contract is validated end-to-end on every fetch via `monitor-sdk.ts`.
 */

import { z } from "zod"

export const KanbanCard = z.object({
  session_id: z.string(),
  title: z.string(),
  status: z.enum(["working", "waiting", "completed", "error", "abandoned"]),
  model: z.string().nullable(),
  cost: z.number(),
  duration_ms: z.number(),
  last_tool: z.string().nullable(),
  parent_id: z.string().nullable(),
  parent_title: z.string().nullable(),
  time_started: z.number(),
  time_updated: z.number(),
})
export type KanbanCard = z.infer<typeof KanbanCard>

export const KanbanBoard = z.object({
  view: z.enum(["sessions", "agents"]),
  columns: z.object({
    working: z.array(KanbanCard),
    waiting: z.array(KanbanCard),
    completed: z.array(KanbanCard),
    error: z.array(KanbanCard),
    abandoned: z.array(KanbanCard),
  }),
  generated_at: z.number(),
})
export type KanbanBoard = z.infer<typeof KanbanBoard>

export const Health = z.object({
  score: z.number().min(0).max(100),
  components: z.object({
    success_rate: z.number(),
    cache_hit_rate: z.number(),
    error_rate: z.number(),
    heap_pct: z.number(),
  }),
  window_sec: z.number(),
  generated_at: z.number(),
})
export type Health = z.infer<typeof Health>

export const WorkflowsReport = z.object({
  datasets: z.object({
    orchestration: z.unknown(),
    tool_sankey: z.unknown(),
    collaboration: z.unknown(),
    subagent_effectiveness: z.unknown(),
    patterns: z.unknown(),
    model_delegation: z.unknown(),
    error_propagation: z.unknown(),
    concurrency: z.unknown(),
    complexity: z.unknown(),
    compaction: z.unknown(),
    per_session: z.unknown(),
  }),
  generated_at: z.number(),
})
export type WorkflowsReport = z.infer<typeof WorkflowsReport>

const Condition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event-pattern"),
    event_type: z.string().optional(),
    tool_name: z.string().optional(),
    summary_contains: z.string().optional(),
    min_count: z.number().int().min(1).default(1),
    window_sec: z.number().int().min(1).default(60),
  }),
  z.object({
    type: z.literal("inactivity"),
    threshold_sec: z.number().int().min(60),
  }),
  z.object({
    type: z.literal("stuck-agent"),
    states: z.array(z.enum(["working", "waiting"])).default(["working", "waiting"]),
    threshold_sec: z.number().int().min(60),
  }),
  z.object({
    type: z.literal("token-threshold"),
    field: z.enum(["input", "output", "cache.read", "cache.write", "total"]).default("total"),
    limit: z.number().int().min(1),
  }),
])
export type Condition = z.infer<typeof Condition>

export const AlertRule = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  type: z.union([
    z.literal("event-pattern"),
    z.literal("inactivity"),
    z.literal("stuck-agent"),
    z.literal("token-threshold"),
  ]),
  condition: Condition,
  cooldown_sec: z.number().int().min(0).default(300),
  enabled: z.boolean().default(true),
  time_created: z.number(),
  time_updated: z.number(),
})
export type AlertRule = z.infer<typeof AlertRule>

export const AlertEvent = z.object({
  id: z.string(),
  rule_id: z.string(),
  session_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(["fired", "acked", "resolved"]),
  time_created: z.number(),
  acked_at: z.number().nullable(),
})
export type AlertEvent = z.infer<typeof AlertEvent>

export type Mood =
  | "idle"
  | "watching"
  | "happy"
  | "worried"
  | "stuck"
  | "thinking"
  | "sleeping"
  | "disconnected"

// --- Workflows dataset shapes --------------------------------------------

export const OrchestrationNode = z.object({
  id: z.string(),
  parent: z.string().nullable(),
  title: z.string(),
})
export const OrchestrationLink = z.object({ source: z.string(), target: z.string() })
export const Orchestration = z.object({
  nodes: z.array(OrchestrationNode),
  links: z.array(OrchestrationLink),
})

export const SankeyNode = z.object({ id: z.string() })
export const SankeyEdge = z.object({ source: z.string(), target: z.string(), value: z.number() })
export const ToolSankey = z.object({ nodes: z.array(SankeyNode), edges: z.array(SankeyEdge) })

export const PerSessionRow = z.object({
  session_id: z.string(),
  title: z.string(),
  cost: z.number(),
  tokens: z.number(),
  tool_calls: z.number(),
  errors: z.number(),
  duration_ms: z.number(),
})

export const ModelFlowSlice = z.object({
  provider: z.string(),
  model: z.string(),
  sessions: z.number(),
  cost: z.number(),
  tokens: z.number(),
})

export const ErrorGroup = z.object({
  message: z.string(),
  count: z.number(),
  sessions: z.array(z.string()),
})

export const ComplexityPoint = z.object({
  session_id: z.string(),
  tokens: z.number(),
  duration_ms: z.number(),
  cost: z.number(),
})

export const CompactionPoint = z.object({
  session_id: z.string(),
  at: z.number(),
  tokens_before: z.number().nullable(),
  tokens_after: z.number().nullable(),
})

export type OrchestrationNode = z.infer<typeof OrchestrationNode>
export type OrchestrationLink = z.infer<typeof OrchestrationLink>
export type Orchestration = z.infer<typeof Orchestration>

export type SankeyNode = z.infer<typeof SankeyNode>
export type SankeyEdge = z.infer<typeof SankeyEdge>
export type ToolSankey = z.infer<typeof ToolSankey>

export type PerSessionRow = z.infer<typeof PerSessionRow>
export type ModelFlowSlice = z.infer<typeof ModelFlowSlice>
export type ErrorGroup = z.infer<typeof ErrorGroup>
export type ComplexityPoint = z.infer<typeof ComplexityPoint>
export type CompactionPoint = z.infer<typeof CompactionPoint>

export type ChannelWrite = z.infer<typeof ChannelWrite>
export type CredentialField = z.infer<typeof CredentialField>
export type ChannelPublic = z.infer<typeof ChannelPublic>

// --- Channel / alert / event shapes (server-side contract) ----------------

export const ChannelWrite = z.object({
  project_id: z.string().min(1),
  type: z.enum([
    "slack",
    "discord",
    "teams",
    "google-chat",
    "mattermost",
    "rocketchat",
    "telegram",
    "pagerduty",
    "opsgenie",
    "splunk-oncall",
    "zapier",
    "make",
    "n8n",
    "pipedream",
    "generic",
  ]),
  name: z.string().min(1).max(80),
  url: z.string().url().optional(),
  credentials: z.record(z.string(), z.string()).default({}),
  secret: z.string().optional(),
  enabled: z.boolean().default(true),
})

export const CredentialField = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  help: z.string().optional(),
})

export const ChannelPublic = z.object({
  id: z.string(),
  project_id: z.string(),
  type: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  credentials: z.record(z.string(), z.string()),
  secret: z.string().nullable(),
  enabled: z.boolean(),
  time_created: z.number(),
  time_updated: z.number(),
  credentialFields: z.array(CredentialField),
})
