/**
 * Composite health score.
 *
 *   health = 0.40 · success_rate
 *         + 0.25 · cache_hit_rate
 *         + 0.25 · (100 − error_rate)
 *         + 0.10 · (100 − heap_pct)
 *
 * All inputs are 0..100 percentages. The score is 0..100.
 *
 * Source of data:
 *
 *   - success_rate : (assistant messages without `error`) / (assistant messages)
 *   - cache_hit_rate : sum(cache.read) / (sum(cache.read) + sum(input) + 1)
 *   - error_rate    : (assistant messages with `error`) / (assistant messages)
 *   - heap_pct      : (runtime / 100MB) clamped 0..100
 *
 * Window: last 5 minutes of assistant messages (configurable via
 * MONITOR_HEALTH_WINDOW_MS).
 */

import { z } from "zod"
import { Database, sql } from "@/storage"
import { Effect } from "effect"

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

const DEFAULT_WINDOW_SEC = 300
const HEAP_BUDGET_BYTES = 100 * 1024 * 1024

interface WindowRow {
  has_error: number
  no_error: number
  cache_read: number
  cache_write: number
  input_tokens: number
}

export const buildHealth = Effect.fn(function* () {
  const windowSec = (() => {
    const raw = parseInt(process.env.MONITOR_HEALTH_WINDOW_SEC ?? "", 10)
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_SEC
  })()
  const sinceMs = Date.now() - windowSec * 1000

  const row = (Database.use((db) =>
    db.all<WindowRow>(
      sql`SELECT
         SUM(CASE WHEN json_extract(data, '$.error') IS NULL THEN 0 ELSE 1 END) as has_error,
         SUM(CASE WHEN json_extract(data, '$.error') IS NULL THEN 1 ELSE 0 END) as no_error,
         COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0) as cache_read,
         COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0) as cache_write,
         COALESCE(SUM(json_extract(data, '$.tokens.input')), 0) as input_tokens
       FROM message
       WHERE json_extract(data, '$.role') = 'assistant'
         AND json_extract(data, '$.time.created') >= ${sinceMs}`,
    ),
  )[0]) ?? {
    has_error: 0,
    no_error: 0,
    cache_read: 0,
    cache_write: 0,
    input_tokens: 0,
  }

  const total = row.has_error + row.no_error
  const successRate = total ? (row.no_error / total) * 100 : 100
  const errorRate = total ? (row.has_error / total) * 100 : 0
  const cacheHitRate =
    row.cache_read + row.input_tokens > 0
      ? (row.cache_read / (row.cache_read + row.input_tokens)) * 100
      : 0

  const heapPct = Math.max(0, Math.min(100, (process.memoryUsage().heapUsed / HEAP_BUDGET_BYTES) * 100))

  const score = Math.max(
    0,
    Math.min(
      100,
      0.4 * successRate + 0.25 * cacheHitRate + 0.25 * (100 - errorRate) + 0.1 * (100 - heapPct),
    ),
  )

  return {
    score,
    components: { success_rate: successRate, cache_hit_rate: cacheHitRate, error_rate: errorRate, heap_pct: heapPct },
    window_sec: windowSec,
    generated_at: Date.now(),
  } satisfies Health
})