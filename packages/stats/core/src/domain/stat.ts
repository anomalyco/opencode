import { sql } from "drizzle-orm"

export const UPSERT_CHUNK_SIZE = 500
const DAY_MS = 86_400_000

export type StatGrain = "day" | "week"

export type StatBaseAggregate = {
  grain: StatGrain
  period_key: string
  dataset: string
  tier: string
  sessions: number
  requests: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  total_tokens: number
  input_cost_microcents: number
  output_cost_microcents: number
  total_cost_microcents: number
  avg_duration_ms: number | null
  p50_duration_ms: number | null
  p95_duration_ms: number | null
  avg_ttfb_ms: number | null
  p50_ttfb_ms: number | null
  p95_ttfb_ms: number | null
  avg_output_tps: number | null
  success_count: number
  error_count: number
  sample_count: number
}

export type StatBaseRow = {
  grain: string
  period_key: string
  dataset?: string
  tier?: string
  client?: string
  source?: string
  sessions?: number
  requests?: number
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
  input_cost_microcents?: number
  output_cost_microcents?: number
  total_cost_microcents?: number
  avg_duration_ms?: number | null
  p50_duration_ms?: number | null
  p95_duration_ms?: number | null
  avg_ttfb_ms?: number | null
  p50_ttfb_ms?: number | null
  p95_ttfb_ms?: number | null
  avg_output_tps?: number | null
  success_count?: number
  error_count?: number
  sample_count?: number
}

export function toStatBaseRow(data: StatBaseAggregate) {
  return {
    grain: data.grain,
    period_key: data.period_key,
    dataset: data.dataset,
    tier: data.tier,
    client: "all",
    source: "all",
    sessions: data.sessions,
    requests: data.requests,
    input_tokens: data.input_tokens,
    output_tokens: data.output_tokens,
    reasoning_tokens: data.reasoning_tokens,
    cache_read_tokens: data.cache_read_tokens,
    total_tokens: data.total_tokens,
    input_cost_microcents: data.input_cost_microcents,
    output_cost_microcents: data.output_cost_microcents,
    total_cost_microcents: data.total_cost_microcents,
    avg_duration_ms: data.avg_duration_ms,
    p50_duration_ms: data.p50_duration_ms,
    p95_duration_ms: data.p95_duration_ms,
    avg_ttfb_ms: data.avg_ttfb_ms,
    p50_ttfb_ms: data.p50_ttfb_ms,
    p95_ttfb_ms: data.p95_ttfb_ms,
    avg_output_tps: data.avg_output_tps,
    success_count: data.success_count,
    error_count: data.error_count,
    sample_count: data.sample_count,
  }
}

export function synthesizeAllTierRows<T extends StatBaseRow>(rows: T[], dimensionKey: (row: T) => string) {
  return [
    ...rows,
    ...Object.values(
      rows.reduce<Record<string, T>>((result, row) => {
        const key = [row.grain, row.period_key, row.dataset, row.client, row.source, dimensionKey(row)].join("\u0000")
        result[key] = result[key] ? combineRows(result[key], row) : { ...row, tier: "all" }
        return result
      }, {}),
    ),
  ]
}

export function collapseRows<T extends StatBaseRow>(rows: T[], dimensionKey: (row: T) => string) {
  return Object.values(
    rows.reduce<Record<string, T>>((result, row) => {
      const key = [row.grain, row.period_key, row.dataset, row.tier, row.client, row.source, dimensionKey(row)].join(
        "\u0000",
      )
      result[key] = result[key] ? combineRows(result[key], row) : row
      return result
    }, {}),
  )
}

export function combineRows<T extends StatBaseRow>(left: T, right: T): T {
  return {
    ...left,
    sessions: (left.sessions ?? 0) + (right.sessions ?? 0),
    requests: (left.requests ?? 0) + (right.requests ?? 0),
    input_tokens: (left.input_tokens ?? 0) + (right.input_tokens ?? 0),
    output_tokens: (left.output_tokens ?? 0) + (right.output_tokens ?? 0),
    reasoning_tokens: (left.reasoning_tokens ?? 0) + (right.reasoning_tokens ?? 0),
    cache_read_tokens: (left.cache_read_tokens ?? 0) + (right.cache_read_tokens ?? 0),
    total_tokens: (left.total_tokens ?? 0) + (right.total_tokens ?? 0),
    input_cost_microcents: (left.input_cost_microcents ?? 0) + (right.input_cost_microcents ?? 0),
    output_cost_microcents: (left.output_cost_microcents ?? 0) + (right.output_cost_microcents ?? 0),
    total_cost_microcents: (left.total_cost_microcents ?? 0) + (right.total_cost_microcents ?? 0),
    avg_duration_ms: weightedAverage(left.avg_duration_ms, left.requests, right.avg_duration_ms, right.requests),
    p50_duration_ms: null,
    p95_duration_ms: null,
    avg_ttfb_ms: weightedAverage(left.avg_ttfb_ms, left.requests, right.avg_ttfb_ms, right.requests),
    p50_ttfb_ms: null,
    p95_ttfb_ms: null,
    avg_output_tps: weightedAverage(left.avg_output_tps, left.requests, right.avg_output_tps, right.requests),
    success_count: (left.success_count ?? 0) + (right.success_count ?? 0),
    error_count: (left.error_count ?? 0) + (right.error_count ?? 0),
    sample_count: (left.sample_count ?? 0) + (right.sample_count ?? 0),
  }
}

export function statPeriodKey(row: StatBaseRow) {
  return [row.grain, row.period_key, row.dataset, row.tier, row.client, row.source].join("\u0000")
}

export function periodKeyFor(grain: StatGrain, periodStart: Date) {
  if (grain === "week") return isoWeekId(periodStart)
  return utcDateId(periodStart)
}

export function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

export function startOfIsoWeek(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() - (value.getUTCDay() || 7) + 1),
  )
}

export function isoWeekId(value: Date) {
  const thursday = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 4 - (value.getUTCDay() || 7)),
  )
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil(((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7)).padStart(2, "0")}`
}

function utcDateId(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`
}

export function rankBy<T extends StatBaseRow>(rows: T[], value: (row: T) => number) {
  return new Map(rows.toSorted((a, b) => value(b) - value(a)).map((row, index) => [row, index + 1]))
}

export function rankRowsWithMarketShare<T extends StatBaseRow>(
  rows: T[],
  groupKey: (row: T) => string = statPeriodKey,
) {
  return Object.values(
    rows.reduce<Record<string, T[]>>((result, row) => {
      const key = groupKey(row)
      result[key] = [...(result[key] ?? []), row]
      return result
    }, {}),
  ).flatMap((group) => {
    const tokens = group.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0)
    const requests = group.reduce((sum, row) => sum + (row.requests ?? 0), 0)
    const sessions = group.reduce((sum, row) => sum + (row.sessions ?? 0), 0)
    const tokenRanks = rankBy(group, (row) => row.total_tokens ?? 0)
    const requestRanks = rankBy(group, (row) => row.requests ?? 0)
    const sessionRanks = rankBy(group, (row) => row.sessions ?? 0)
    const costRanks = rankBy(group, (row) => row.total_cost_microcents ?? 0)
    return group.map((row) => ({
      ...row,
      market_share_tokens: share(row.total_tokens, tokens),
      market_share_requests: share(row.requests, requests),
      market_share_sessions: share(row.sessions, sessions),
      rank_by_tokens: tokenRanks.get(row) ?? null,
      rank_by_requests: requestRanks.get(row) ?? null,
      rank_by_sessions: sessionRanks.get(row) ?? null,
      rank_by_cost: costRanks.get(row) ?? null,
    }))
  })
}

export function share(value: number | null | undefined, total: number) {
  if (total <= 0) return null
  return Number(((value ?? 0) / total).toFixed(6))
}

export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )
}

export function inserted(column: string) {
  return sql.raw(`values(\`${column}\`)`)
}

export function weightedAverage(
  left: number | null | undefined,
  leftWeight = 0,
  right: number | null | undefined,
  rightWeight = 0,
) {
  const totalWeight =
    (left === null || left === undefined ? 0 : leftWeight) + (right === null || right === undefined ? 0 : rightWeight)
  if (totalWeight === 0) return null
  return Number((((left ?? 0) * leftWeight + (right ?? 0) * rightWeight) / totalWeight).toFixed(2))
}

export function normalizeTier(value: string) {
  if (value === "Paid") return "Zen"
  return value
}

export function normalizeCountry(value: string | undefined) {
  if (!value || value.length !== 2) return "ZZ"
  return value.toUpperCase()
}
