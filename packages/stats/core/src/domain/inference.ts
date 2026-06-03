import { Resource } from "sst/resource"
import type { AthenaData } from "../athena"
import type { GeoStatAggregate } from "./geo"
import type { ModelStatAggregate } from "./model"
import { EXCLUDED_MODELS, MODEL_AUTHOR_RULES, statModel, statProvider } from "./model-normalization"
import type { ProviderStatAggregate } from "./provider"
import { normalizeCountry, normalizeTier, type StatBaseAggregate } from "./stat"

export type StatDimension = "model" | "provider" | "geo" | "geo_model"

export function buildStatsQuery(periodStart: Date, periodEnd: Date, dimension: StatDimension) {
  const periodStartValue = sqlString(periodStart.toISOString())
  const periodEndValue = sqlString(periodEnd.toISOString())
  const sourceTable = [Resource.InferenceEvent.catalog, Resource.InferenceEvent.database, Resource.InferenceEvent.table]
    .map(sqlIdentifier)
    .join(".")
  const dimensionSql = (() => {
    if (dimension === "model")
      return {
        select: "provider, model, COALESCE(MAX(NULLIF(provider_model, '')), '') AS provider_model",
        groupBy: "provider, model",
      }
    if (dimension === "provider") return { select: "provider", groupBy: "provider" }
    if (dimension === "geo_model")
      return {
        select: "provider, model, country, COALESCE(MAX(NULLIF(continent, '')), '') AS continent",
        groupBy: "provider, model, country",
      }
    return {
      select: "'all' AS provider, 'all' AS model, country, COALESCE(MAX(NULLIF(continent, '')), '') AS continent",
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
WITH normalized AS (
  SELECT
    from_iso8601_timestamp(event_timestamp) AS event_time,
    model AS raw_model,
    ${statModelSql("model", "provider_model")} AS model,
    COALESCE(NULLIF(provider_model, ''), '') AS provider_model,
    UPPER(COALESCE(NULLIF(cf_country, ''), 'ZZ')) AS country,
    COALESCE(NULLIF(cf_continent, ''), '') AS continent,
    session,
    status,
    duration AS duration_ms,
    time_to_first_byte AS ttfb_ms,
    timestamp_first_byte,
    timestamp_last_byte,
    tokens_input,
    tokens_output,
    tokens_reasoning,
    tokens_cache_read,
    tokens_cache_write_5m,
    cost_input_microcents,
    cost_output_microcents,
    cost_total_microcents,
    cost_input,
    cost_output,
    cost_total,
    source
  FROM ${sourceTable}
  WHERE event_type = 'completions'
    AND model IS NOT NULL
    AND model <> ''
    AND (strpos(COALESCE(user_agent, ''), 'ai-sdk') > 0 OR strpos(COALESCE(user_agent, ''), 'opencode') > 0)
    AND event_timestamp >= ${periodStartValue}
    AND event_timestamp < ${periodEndValue}
), filtered AS (
  SELECT
    event_time,
    CASE
      WHEN source = 'lite' THEN 'Go'
      WHEN raw_model IN ('gpt-5-nano', 'grok-code', 'big-pickle') OR regexp_like(raw_model, '-free(:global)?$') THEN 'Free'
      ELSE 'Paid'
    END AS tier,
    ${statProviderSql("model", "provider_model")} AS provider,
    provider_model,
    model,
    country,
    continent,
    session,
    status,
    duration_ms,
    ttfb_ms,
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
  FROM normalized
  WHERE lower(model) NOT IN (${[...EXCLUDED_MODELS].map(sqlString).join(", ")})
), weekly AS (
  SELECT
    concat(CAST(year_of_week(event_time) AS varchar), '-W', lpad(CAST(week(event_time) AS varchar), 2, '0')) AS week_key,
    *
  FROM filtered
), daily AS (
  SELECT substr(to_iso8601(date_trunc('day', event_time)), 1, 10) AS day_key, *
  FROM filtered
)
SELECT
  'week' AS grain,
  week_key AS period_key,
  ${sqlString(Resource.StatsSyncConfig.dataset)} AS dataset,
  tier,
  ${dimensionSql.select},
  ${aggregateColumns}
FROM weekly
GROUP BY week_key, tier, ${dimensionSql.groupBy}
UNION ALL
SELECT
  'day' AS grain,
  day_key AS period_key,
  ${sqlString(Resource.StatsSyncConfig.dataset)} AS dataset,
  tier,
  ${dimensionSql.select},
  ${aggregateColumns}
FROM daily
GROUP BY day_key, tier, ${dimensionSql.groupBy}
ORDER BY grain, period_key, total_tokens DESC
`
}

export function toModelAggregate(data: AthenaData): ModelStatAggregate[] {
  const model = statModel(data.model, data.provider_model)
  const provider = statProvider(model, data.provider_model, data.provider)
  if (!provider) return []

  return toStatBaseAggregate(data).flatMap((base) => [
    { ...base, provider, model, provider_model: data.provider_model || "" },
  ])
}

export function toProviderAggregate(data: AthenaData): ProviderStatAggregate[] {
  return toStatBaseAggregate(data).flatMap((base) => [
    { ...base, provider: statProvider(data.model, data.provider_model, data.provider) || "unknown" },
  ])
}

export function toGeoAggregate(data: AthenaData): GeoStatAggregate[] {
  return toStatBaseAggregate(data).flatMap((base) => [
    {
      ...base,
      provider: statProvider(data.model, data.provider_model, data.provider) || "all",
      model: statModel(data.model || "all", data.provider_model),
      country: normalizeCountry(data.country),
      continent: data.continent || "",
    },
  ])
}

function toStatBaseAggregate(data: AthenaData): StatBaseAggregate[] {
  const grain = data.grain === "day" || data.grain === "week" ? data.grain : undefined
  if (!grain || !data.period_key) return []

  return [
    {
      grain,
      period_key: data.period_key,
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

function statModelSql(model: string, providerModel: string) {
  return `COALESCE(NULLIF(regexp_replace(CASE
      WHEN ${model} = 'big-pickle' THEN COALESCE(NULLIF(${providerModel}, ''), ${model})
      ELSE ${model}
    END, '(-free|:global)+$', ''), ''), 'unknown')`
}

function statProviderSql(model: string, providerModel: string) {
  return `CASE
${MODEL_AUTHOR_RULES.map((item) => `      WHEN strpos(lower(${providerModel}), ${sqlString(item.match)}) > 0 THEN ${sqlString(item.author)}`).join("\n")}
${MODEL_AUTHOR_RULES.map((item) => `      WHEN strpos(lower(${model}), ${sqlString(item.match)}) > 0 THEN ${sqlString(item.author)}`).join("\n")}
      ELSE 'unknown'
    END`
}
