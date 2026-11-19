/** Metric event types and factory (spec Part B §4). */
import type { MetricEvent } from "./types"

export const METRIC_EVENTS = [
  "llm_call",
  "extraction_started",
  "extraction_completed",
  "extraction_failed",
  "consolidation_started",
  "consolidation_completed",
  "consolidation_failed",
  "swap",
  "swap_deferred",
  "cutoff_missing",
  "render_truncated",
  "rollover_error",
  "ledger_enriched",
] as const

export type MetricEventName = (typeof METRIC_EVENTS)[number]

export function metricEvent(
  ev: MetricEventName,
  sessionId: string,
  epoch: number | undefined,
  detail: Record<string, unknown> = {},
): MetricEvent {
  const out: MetricEvent = { ev, ts: Date.now(), sessionId, ...detail }
  if (epoch !== undefined) out.epoch = epoch
  return out
}
