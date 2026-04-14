import { z } from "zod"

const positive = z.number().positive()
const nonNegative = z.number().nonnegative()

const capsDefaults = {
  tools: ["read", "glob", "grep", "list"] as string[],
  share_to_team: false,
  delegate: true,
  max_delegation_depth: 2,
  disk_quota_mb: 500,
}

const AgentCapabilitiesConfigSchema = z
  .object({
    tools: z.array(z.string()).default(capsDefaults.tools),
    share_to_team: z.boolean().default(capsDefaults.share_to_team),
    delegate: z.boolean().default(capsDefaults.delegate),
    max_delegation_depth: z.number().default(capsDefaults.max_delegation_depth),
    disk_quota_mb: z.number().default(capsDefaults.disk_quota_mb),
  })
  .default(capsDefaults)

const AgentConfigSchema = z.object({
  role: z.string(),
  role_priority: z.number().default(10),
  model: z.string().optional(),
  capabilities: AgentCapabilitiesConfigSchema,
  max_tasks_per_day: z.number().default(50),
  disk_quota_mb: z.number().default(500),
})

const limitsDefaults = {
  max_agents: 10,
  max_concurrent_tasks: 5,
  max_delegation_depth: 3,
  max_messages_per_minute: 30,
  message_ttl_seconds: 86400,
  task_timeout_seconds: 1800,
  tool_execution_timeout_seconds: 60,
}

const budgetDefaults = {
  daily_limit_usd: 50,
  per_agent_daily_usd: 15,
  per_task_max_usd: 5,
  per_task_max_tokens: 200000,
}

const gcDefaults = {
  cleanup_timeout_ms: 259200000,
  gc_interval_ms: 3600000,
  dead_letter_retention_days: 7,
}

const watchdogDefaults = {
  heartbeat_interval_ms: 30000,
  heartbeat_warning_ms: 60000,
  zombie_timeout_ms: 120000,
  reconnect_timeout_ms: 10000,
}

const gitDefaults = {
  protected_branches: ["main", "dev"] as string[],
  denied_commands: ["push --force", "reset --hard"] as string[],
}

export const TeamConfigSchema = z.object({
  enabled: z.boolean().default(false),
  agents: z.record(z.string(), AgentConfigSchema).default({}),
  humans: z
    .object({
      hierarchy: z.array(z.string()).default(["admin", "developer"]),
    })
    .default({ hierarchy: ["admin", "developer"] }),
  human_authority: z.enum(["always", "advisory", "none"]).default("always"),
  limits: z
    .object({
      max_agents: positive.default(limitsDefaults.max_agents),
      max_concurrent_tasks: nonNegative.default(limitsDefaults.max_concurrent_tasks),
      max_delegation_depth: nonNegative.default(limitsDefaults.max_delegation_depth),
      max_messages_per_minute: positive.default(limitsDefaults.max_messages_per_minute),
      message_ttl_seconds: positive.default(limitsDefaults.message_ttl_seconds),
      task_timeout_seconds: positive.default(limitsDefaults.task_timeout_seconds),
      tool_execution_timeout_seconds: positive.default(limitsDefaults.tool_execution_timeout_seconds),
    })
    .default(limitsDefaults),
  budget: z
    .object({
      daily_limit_usd: nonNegative.default(budgetDefaults.daily_limit_usd),
      per_agent_daily_usd: nonNegative.default(budgetDefaults.per_agent_daily_usd),
      per_task_max_usd: nonNegative.default(budgetDefaults.per_task_max_usd),
      per_task_max_tokens: nonNegative.default(budgetDefaults.per_task_max_tokens),
    })
    .default(budgetDefaults),
  gc: z
    .object({
      cleanup_timeout_ms: positive.default(gcDefaults.cleanup_timeout_ms),
      gc_interval_ms: positive.default(gcDefaults.gc_interval_ms),
      dead_letter_retention_days: positive.default(gcDefaults.dead_letter_retention_days),
    })
    .default(gcDefaults),
  watchdog: z
    .object({
      heartbeat_interval_ms: positive.default(watchdogDefaults.heartbeat_interval_ms),
      heartbeat_warning_ms: positive.default(watchdogDefaults.heartbeat_warning_ms),
      zombie_timeout_ms: positive.default(watchdogDefaults.zombie_timeout_ms),
      reconnect_timeout_ms: positive.default(watchdogDefaults.reconnect_timeout_ms),
    })
    .default(watchdogDefaults),
  protected_paths: z.array(z.string()).default([]),
  git: z
    .object({
      protected_branches: z.array(z.string()).default(gitDefaults.protected_branches),
      denied_commands: z.array(z.string()).default(gitDefaults.denied_commands),
      pre_merge_validation: z.string().optional(),
    })
    .default(gitDefaults),
})

export type TeamConfig = z.infer<typeof TeamConfigSchema>

export function parseTeamConfig(input: unknown): TeamConfig {
  return TeamConfigSchema.parse(input)
}
