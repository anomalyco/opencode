export type AgentConfig = {
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  disable?: boolean
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  options?: Record<string, unknown>
  color?: string
  steps?: number
  permission?: Record<string, unknown>
}

export type PluginConfig = {
  max_depth: number
  max_retry: number
  sync_timeout_ms: number
  broadcast_max_recipients: number
  broadcast_rate_limit_per_minute: number
  include_thinking: boolean
  message_ttl_ms: number
  db_path: string
}

const DEFAULTS: PluginConfig = {
  max_depth: 5,
  max_retry: 2,
  sync_timeout_ms: 60000,
  broadcast_max_recipients: 10,
  broadcast_rate_limit_per_minute: 5,
  include_thinking: false,
  message_ttl_ms: 86400000,
  db_path: ".opencode/agent-comms.db",
}

function validatePositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`Config ${field} must be a positive number`)
  return value
}

function validateNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`Config ${field} must be a non-negative number`)
  return value
}

export function parseConfig(options: Record<string, unknown> | undefined, projectDir: string): PluginConfig {
  const opts = options ?? {}

  const max_depth = opts.max_depth !== undefined ? validatePositive(opts.max_depth, "max_depth") : DEFAULTS.max_depth
  const max_retry = opts.max_retry !== undefined ? validateNonNegative(opts.max_retry, "max_retry") : DEFAULTS.max_retry
  const sync_timeout_ms =
    opts.sync_timeout_ms !== undefined
      ? validatePositive(opts.sync_timeout_ms, "sync_timeout_ms")
      : DEFAULTS.sync_timeout_ms
  const broadcast_max_recipients =
    opts.broadcast_max_recipients !== undefined
      ? validatePositive(opts.broadcast_max_recipients, "broadcast_max_recipients")
      : DEFAULTS.broadcast_max_recipients
  const broadcast_rate_limit_per_minute =
    opts.broadcast_rate_limit_per_minute !== undefined
      ? validatePositive(opts.broadcast_rate_limit_per_minute, "broadcast_rate_limit_per_minute")
      : DEFAULTS.broadcast_rate_limit_per_minute
  const include_thinking =
    opts.include_thinking !== undefined ? Boolean(opts.include_thinking) : DEFAULTS.include_thinking
  const message_ttl_ms =
    opts.message_ttl_ms !== undefined
      ? validatePositive(opts.message_ttl_ms, "message_ttl_ms")
      : DEFAULTS.message_ttl_ms
  const db_path =
    typeof opts.db_path === "string" && opts.db_path.trim()
      ? resolveDbPath(opts.db_path, projectDir)
      : resolveDbPath(DEFAULTS.db_path, projectDir)

  return {
    max_depth,
    max_retry,
    sync_timeout_ms,
    broadcast_max_recipients,
    broadcast_rate_limit_per_minute,
    include_thinking,
    message_ttl_ms,
    db_path,
  }
}

function resolveDbPath(raw: string, projectDir: string): string {
  if (raw === ":memory:") return raw
  if (raw.startsWith("/")) return raw
  return `${projectDir}/${raw}`.replace(/\/+/g, "/")
}
