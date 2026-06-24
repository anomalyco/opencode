/**
 * Drizzle schema for the monitor module.
 *
 * Four tables. All persistence is *derived* state — the raw session / message
 * / event data lives in opencode's own tables and is read via Drizzle
 * queries at request time. The tables below only hold:
 *
 *   - `monitor_alert_rule`     : user-defined rules
 *   - `monitor_alert_event`    : fired alert log + ack state
 *   - `monitor_alert_channel`  : webhook destinations (Slack, Discord, generic, …)
 *   - `monitor_metric`         : pre-aggregated time-series rollups for charts
 *
 * Per `packages/opencode/AGENTS.md`: tables and columns are snake_case,
 * foreign-key columns are `<entity>_id`, indexes are `<table>_<column>_idx`.
 *
 * `project_id` is stored as plain `text` (no typed FK reference) so this
 * module has no compile-time dependency on `ProjectTable`'s alias path —
 * the migration that opencode generates automatically wires the FK to
 * `project(id)` when both tables exist.
 */

import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

const Timestamps = {
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
}

// --- alert_rule -----------------------------------------------------------

export const AlertRuleTable = sqliteTable(
  "monitor_alert_rule",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    name: text().notNull(),
    // event-pattern | inactivity | stuck-agent | token-threshold
    type: text({ enum: ["event-pattern", "inactivity", "stuck-agent", "token-threshold"] }).notNull(),
    condition: text({ mode: "json" }).$type<unknown>().notNull(),
    cooldown_sec: integer().notNull().default(300),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    ...Timestamps,
  },
  (table) => [
    index("monitor_alert_rule_project_idx").on(table.project_id),
    index("monitor_alert_rule_enabled_idx").on(table.enabled),
  ],
)

// --- alert_event ----------------------------------------------------------

export const AlertEventTable = sqliteTable(
  "monitor_alert_event",
  {
    id: text().primaryKey(),
    rule_id: text()
      .notNull()
      .references(() => AlertRuleTable.id, { onDelete: "cascade" }),
    session_id: text(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text({ enum: ["fired", "acked", "resolved"] }).notNull().default("fired"),
    ...Timestamps,
    acked_at: integer(),
  },
  (table) => [
    index("monitor_alert_event_rule_idx").on(table.rule_id),
    index("monitor_alert_event_session_idx").on(table.session_id),
    index("monitor_alert_event_time_idx").on(table.time_created),
  ],
)

// --- alert_channel --------------------------------------------------------

export const AlertChannelTable = sqliteTable(
  "monitor_alert_channel",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    // See ./webhook.ts for the registry; this column is the registry key.
    type: text().notNull(),
    name: text().notNull(),
    url: text(),
    credentials: text({ mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    // HMAC secret for the generic provider; null otherwise. Never returned
    // by the API — masked as `***` like the rest of opencode's settings.
    secret: text(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    ...Timestamps,
  },
  (table) => [
    index("monitor_alert_channel_project_idx").on(table.project_id),
    index("monitor_alert_channel_enabled_idx").on(table.enabled),
  ],
)

// --- monitor_metric (rollups) --------------------------------------------

export const MonitorMetricTable = sqliteTable(
  "monitor_metric",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    session_id: text(),
    // e.g. "tool_call", "cache_hit", "error", "compaction", "cost_usd"
    kind: text().notNull(),
    value: real().notNull(),
    dimensions: text({ mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    // 5m | 1h | 1d
    bucket: text({ enum: ["5m", "1h", "1d"] }).notNull(),
    bucket_start: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("monitor_metric_project_kind_idx").on(table.project_id, table.kind),
    index("monitor_metric_session_idx").on(table.session_id),
    index("monitor_metric_bucket_idx").on(table.bucket, table.bucket_start),
  ],
)

export type AlertRule = typeof AlertRuleTable.$inferSelect
export type AlertEvent = typeof AlertEventTable.$inferSelect
export type AlertChannel = typeof AlertChannelTable.$inferSelect
export type MonitorMetric = typeof MonitorMetricTable.$inferSelect