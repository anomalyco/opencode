import { Resource } from "sst/resource"
import type { AthenaData } from "../athena"
import type { GeoStatAggregate } from "./geo"
import type { ModelStatAggregate } from "./model"
import type { ProviderStatAggregate } from "./provider"
import { normalizeCountry, normalizeTier, type StatBaseAggregate } from "./stat"

export type StatDimension = "model" | "provider" | "geo"

export function buildStatsQuery(periodStart: Date, periodEnd: Date, dimension: StatDimension) {
  const periodStartValue = sqlString(periodStart.toISOString())
  const periodEndValue = sqlString(periodEnd.toISOString())
  const sourceTable = [
    Resource.InferenceEvent.catalog,
    Resource.InferenceEvent.database,
    Resource.InferenceEvent.table,
  ]
    .map(sqlIdentifier)
    .join(".")
  const dimensionSql = (() => {
    if (dimension === "model")
      return {
        select: "provider, model, COALESCE(MAX(NULLIF(provider_model, '')), '') AS provider_model",
        groupBy: "provider, model",
      }
    if (dimension === "provider") return { select: "provider", groupBy: "provider" }
    return {
      select: "country, COALESCE(MAX(NULLIF(continent, '')), '') AS continent",
      groupBy: "country",
    }
  })()
  const aggregateColumns = `
    COUNT(DISTINCT session) AS sessions,
    COUNT(*) AS requests,
    COALESCE(SUM(tokens_input), 0) AS input_tokens,
    COALESCE(SUM(tokens_output), 0) AS output_tokens,
    COALESCE(SUM(tokens_reasoning), 0) AS reasoning_tokens,
    COALESCE(SUM(tokens_cache_read), 0) AS cache_read_tokens,
    COALESCE(SUM(tokens_total), 0) AS total_tokens,
    COALESCE(SUM(cost_input_microcents), 0) AS input_cost_microcents,
    COALESCE(SUM(cost_output_microcents), 0) AS output_cost_microcents,
    COALESCE(SUM(cost_total_microcents), 0) AS total_cost_microcents,
    AVG(duration_ms) AS avg_duration_ms,
    approx_percentile(CAST(duration_ms AS double), 0.5) AS p50_duration_ms,
    approx_percentile(CAST(duration_ms AS double), 0.95) AS p95_duration_ms,
    AVG(ttfb_ms) AS avg_ttfb_ms,
    approx_percentile(CAST(ttfb_ms AS double), 0.5) AS p50_ttfb_ms,
    approx_percentile(CAST(ttfb_ms AS double), 0.95) AS p95_ttfb_ms,
    AVG(output_tps) AS avg_output_tps,
    SUM(CASE WHEN status >= 200 AND status < 400 THEN 1 ELSE 0 END) AS success_count,
    SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_count,
    COUNT(*) AS sample_count`

  return `
WITH filtered AS (
  SELECT
    from_iso8601_timestamp(event_timestamp) AS event_time,
    CASE
      WHEN source = 'lite' THEN 'Go'
      WHEN model IN ('gpt-5-nano', 'grok-code', 'big-pickle') OR model LIKE '%-free' THEN 'Free'
      ELSE 'Paid'
    END AS tier,
    COALESCE(NULLIF(
      CASE
        WHEN starts_with(provider, 'minimax-plan') THEN 'minimax-plan'
        WHEN starts_with(provider, 'zai-plan') THEN 'zai-plan'
        WHEN starts_with(provider, 'azure-databricks') THEN 'azure-databricks'
        WHEN regexp_like(provider, '^azure[0-9]+') THEN 'azure-openai'
        ELSE provider
      END,
      ''
    ), 'unknown') AS provider,
    COALESCE(NULLIF(provider_model, ''), '') AS provider_model,
    COALESCE(NULLIF(model, ''), 'unknown') AS model,
    UPPER(COALESCE(NULLIF(cf_country, ''), 'ZZ')) AS country,
    COALESCE(NULLIF(cf_continent, ''), '') AS continent,
    session,
    status,
    duration AS duration_ms,
    time_to_first_byte AS ttfb_ms,
    CASE
      WHEN timestamp_last_byte - timestamp_first_byte < 100 THEN null
      ELSE CAST(tokens_output AS double) / (timestamp_last_byte - timestamp_first_byte) * 1000
    END AS output_tps,
    tokens_input,
    tokens_output,
    tokens_reasoning,
    tokens_cache_read,
    COALESCE(tokens_cache_read, 0) + COALESCE(tokens_cache_write_5m, 0) + COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) AS tokens_total,
    COALESCE(cost_input_microcents, cost_input * 1000000) AS cost_input_microcents,
    COALESCE(cost_output_microcents, cost_output * 1000000) AS cost_output_microcents,
    COALESCE(cost_total_microcents, cost_total * 1000000) AS cost_total_microcents
  FROM ${sourceTable}
  WHERE event_type = 'completions'
    AND model IS NOT NULL
    AND model <> ''
    AND (strpos(COALESCE(user_agent, ''), 'ai-sdk') > 0 OR strpos(COALESCE(user_agent, ''), 'opencode') > 0)
    AND event_timestamp >= ${periodStartValue}
    AND event_timestamp < ${periodEndValue}
), daily AS (
  SELECT date_trunc('day', event_time) AS day, *
  FROM filtered
)
SELECT
  'week' AS grain,
  ${periodStartValue} AS period_start,
  ${periodEndValue} AS period_end,
  ${sqlString(Resource.StatsSyncConfig.dataset)} AS dataset,
  tier,
  ${dimensionSql.select},
  ${aggregateColumns}
FROM filtered
GROUP BY tier, ${dimensionSql.groupBy}
UNION ALL
SELECT
  'day' AS grain,
  to_iso8601(day) AS period_start,
  to_iso8601(least(day + INTERVAL '1' DAY, from_iso8601_timestamp(${periodEndValue}))) AS period_end,
  ${sqlString(Resource.StatsSyncConfig.dataset)} AS dataset,
  tier,
  ${dimensionSql.select},
  ${aggregateColumns}
FROM daily
GROUP BY day, tier, ${dimensionSql.groupBy}
ORDER BY grain, period_start, total_tokens DESC
`
}

export function toModelAggregate(data: AthenaData): ModelStatAggregate[] {
  return toStatBaseAggregate(data).flatMap((base) => [
    {
      ...base,
      provider: data.provider || "unknown",
      model: data.model || "unknown",
      provider_model: data.provider_model || "",
    },
  ])
}

export function toProviderAggregate(data: AthenaData): ProviderStatAggregate[] {
  return toStatBaseAggregate(data).flatMap((base) => [{ ...base, provider: data.provider || "unknown" }])
}

export function toGeoAggregate(data: AthenaData): GeoStatAggregate[] {
  return toStatBaseAggregate(data).flatMap((base) => [
    {
      ...base,
      country: normalizeCountry(data.country),
      continent: data.continent || "",
    },
  ])
}

function toStatBaseAggregate(data: AthenaData): StatBaseAggregate[] {
  const grain = data.grain === "day" || data.grain === "week" ? data.grain : undefined
  const periodStart = new Date(data.period_start ?? "")
  const periodEnd = new Date(data.period_end ?? "")
  if (!grain || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) return []

  return [
    {
      grain,
      period_start: periodStart,
      period_end: periodEnd,
      dataset: data.dataset || Resource.StatsSyncConfig.dataset,
      tier: normalizeTier(data.tier || "unknown"),
      sessions: integer(data, "sessions"),
      requests: integer(data, "requests"),
      input_tokens: integer(data, "input_tokens"),
      output_tokens: integer(data, "output_tokens"),
      reasoning_tokens: integer(data, "reasoning_tokens"),
      cache_read_tokens: integer(data, "cache_read_tokens"),
      total_tokens: integer(data, "total_tokens"),
      input_cost_microcents: integer(data, "input_cost_microcents"),
      output_cost_microcents: integer(data, "output_cost_microcents"),
      total_cost_microcents: integer(data, "total_cost_microcents"),
      avg_duration_ms: nullableNumber(data, "avg_duration_ms"),
      p50_duration_ms: nullableInteger(data, "p50_duration_ms"),
      p95_duration_ms: nullableInteger(data, "p95_duration_ms"),
      avg_ttfb_ms: nullableNumber(data, "avg_ttfb_ms"),
      p50_ttfb_ms: nullableInteger(data, "p50_ttfb_ms"),
      p95_ttfb_ms: nullableInteger(data, "p95_ttfb_ms"),
      avg_output_tps: nullableNumber(data, "avg_output_tps"),
      success_count: integer(data, "success_count"),
      error_count: integer(data, "error_count"),
      sample_count: integer(data, "sample_count"),
    },
  ]
}

function integer(data: AthenaData, key: string) {
  return Math.round(number(data, key))
}

function nullableNumber(data: AthenaData, key: string) {
  if (data[key] === undefined || data[key] === "") return null
  return Number(number(data, key).toFixed(2))
}

function nullableInteger(data: AthenaData, key: string) {
  if (data[key] === undefined || data[key] === "") return null
  return Math.round(number(data, key))
}

function number(data: AthenaData, key: string) {
  const value = Number(data[key])
  return Number.isFinite(value) ? value : 0
}

function sqlIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}
