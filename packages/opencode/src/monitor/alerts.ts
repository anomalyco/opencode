/**
 * Alert rule engine — pure evaluation + cooldown dedup.
 *
 * Four condition types, evaluated either event-driven (after each
 * `Bus.publish` lands in the monitor service) or on a 60s time sweep:
 *
 *   event-pattern    | matches event type / tool name / summary text,
 *                    | optionally requiring N events in a time window
 *   inactivity       | active session with no events for N minutes
 *   stuck-agent      | agent sitting in "working"/"waiting" with no activity
 *                    | for N minutes
 *   token-threshold  | session total tokens past a limit
 *
 * Fired alerts are persisted to `monitor_alert_event` with per-rule +
 * per-session cooldown dedup. Delivery to webhook channels is handled by
 * `./webhook.ts`. The subscriber that drives `evaluate` lives in
 * `./engine.ts`.
 */

import { z } from "zod"

export const EventPatternCondition = z.object({
  type: z.literal("event-pattern"),
  event_type: z.string().optional(),
  tool_name: z.string().optional(),
  summary_contains: z.string().optional(),
  min_count: z.number().int().min(1).default(1),
  window_sec: z.number().int().min(1).default(60),
})

export const InactivityCondition = z.object({
  type: z.literal("inactivity"),
  threshold_sec: z.number().int().min(60),
})

export const StuckAgentCondition = z.object({
  type: z.literal("stuck-agent"),
  states: z.array(z.enum(["working", "waiting"])).default(["working", "waiting"]),
  threshold_sec: z.number().int().min(60),
})

export const TokenThresholdCondition = z.object({
  type: z.literal("token-threshold"),
  field: z.enum(["input", "output", "cache.read", "cache.write", "total"]).default("total"),
  limit: z.number().int().min(1),
})

export const Condition = z.discriminatedUnion("type", [
  EventPatternCondition,
  InactivityCondition,
  StuckAgentCondition,
  TokenThresholdCondition,
])
export type Condition = z.infer<typeof Condition>

export const AlertRule = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  type: z.union([z.literal("event-pattern"), z.literal("inactivity"), z.literal("stuck-agent"), z.literal("token-threshold")]),
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

/**
 * Shaped event passed to the rule engine. We accept an `unknown` payload
 * field rather than the full opencode `Event` union so the engine stays
 * decoupled from the bus schema.
 */
export interface RuleEvent {
  readonly type: string
  readonly payload?: Record<string, unknown>
  readonly at: number
}

/**
 * Token totals snapshot — fed in by the engine on each token-bearing event
 * for the `token-threshold` condition.
 */
export interface TokenTotals {
  readonly input: number
  readonly output: number
  readonly "cache.read": number
  readonly "cache.write": number
  readonly total: number
}

/**
 * Evaluate a single rule against the current event / token snapshot.
 *
 * Returns the payload to record if the rule fires (caller is responsible
 * for the cooldown dedup + persistence + delivery), or `null` if the
 * rule does not match.
 *
 * The function is pure — no I/O, no time-of-day, no DB. All side effects
 * live in `./engine.ts` and `./repo.ts`.
 */
export function evaluate(
  rule: AlertRule,
  ctx: {
    readonly now: number
    readonly event?: RuleEvent
    readonly tokens?: TokenTotals
    readonly sessionEventCount?: (ruleId: string, sinceMs: number) => number
  },
): Record<string, unknown> | null {
  if (!rule.enabled) return null
  const condition = rule.condition
  switch (condition.type) {
    case "event-pattern": {
      if (!ctx.event) return null
      if (condition.event_type && ctx.event.type !== condition.event_type) return null
      if (condition.tool_name) {
        const payload = ctx.event.payload ?? {}
        const tool = (payload["tool"] as string | undefined) ?? ""
        if (tool !== condition.tool_name) return null
      }
      if (condition.summary_contains) {
        const summary = String(ctx.event.payload?.["summary"] ?? "")
        if (!summary.includes(condition.summary_contains)) return null
      }
      if (condition.min_count > 1) {
        const count = ctx.sessionEventCount?.(rule.id, ctx.now - condition.window_sec * 1000) ?? 0
        if (count < condition.min_count) return null
      }
      return {
        event_type: ctx.event.type,
        session_id: ctx.event.payload?.["sessionID"] ?? null,
        payload: ctx.event.payload ?? {},
      }
    }
    case "inactivity": {
      const lastEventAt = (ctx.event?.at ?? 0) || ctx.now
      const idle = ctx.now - lastEventAt
      if (idle < condition.threshold_sec * 1000) return null
      return { idle_ms: idle, threshold_sec: condition.threshold_sec }
    }
    case "stuck-agent": {
      if (!ctx.event) return null
      const status = ctx.event.payload?.["status"] as string | undefined
      if (!status || !condition.states.includes(status as "working" | "waiting")) return null
      const elapsed = ctx.now - ctx.event.at
      if (elapsed < condition.threshold_sec * 1000) return null
      return { status, elapsed_ms: elapsed }
    }
    case "token-threshold": {
      if (!ctx.tokens) return null
      const value = ctx.tokens[condition.field]
      if (value < condition.limit) return null
      return { field: condition.field, value, limit: condition.limit }
    }
  }
}

/**
 * In-memory cooldown key. Per `(rule_id, session_id)` so the same rule
 * firing on a different session doesn't suppress.
 *
 * The engine holds a `Map` of these; persistence is intentional to keep
 * the engine restarts idempotent — losing the window means a re-fire is
 * possible, which is the safe default for an alerting system.
 */
export const cooldownKey = (ruleId: string, sessionId: string | null): string =>
  `${ruleId}|${sessionId ?? "_"}`

export function inCooldown(lastFireMs: number, now: number, cooldownSec: number): boolean {
  return now - lastFireMs < cooldownSec * 1000
}
