import { Client } from "@planetscale/database"
import { drizzle } from "drizzle-orm/planetscale-serverless"
import { geoStat, modelStat, providerStat } from "./database/schema"
import {
  chunks,
  collapseRows,
  inserted,
  normalizeCountry,
  normalizeTier,
  rankBy,
  rankRowsWithMarketShare,
  statPeriodKey,
  synthesizeAllTierRows,
  toStatBaseRow,
  UPSERT_CHUNK_SIZE,
  type StatBaseAggregate,
} from "./domain/stat"

const DAY_MS = 86_400_000
const DEFAULT_DAYS = 60
const FREE_MODELS = new Set(["gpt-5-nano", "grok-code", "big-pickle"])

type Grain = "day" | "week"
type MetricDimension = "model" | "provider" | "geo"
type LookupDimension = "model-provider-model" | "geo-continent"
type ImportKey = `${MetricDimension | LookupDimension}-${Grain}`
type RawRow = Record<string, string>
type Period = { start: Date; end: Date }
type Timing = { start_time: number; end_time: number; granularity?: number }
type ImportOptions = {
  dataset: string
  databaseUrl: string | undefined
  dryRun: boolean
  periodEnd: Date | undefined
  periodStart: Date | undefined
  files: Partial<Record<ImportKey, string>>
}
type ModelAggregate = StatBaseAggregate & { provider: string; model: string; provider_model: string }
type ProviderAggregate = StatBaseAggregate & { provider: string }
type GeoAggregate = StatBaseAggregate & { country: string; continent: string }
type ModelStatRow = typeof modelStat.$inferInsert
type ProviderStatRow = typeof providerStat.$inferInsert
type GeoStatRow = typeof geoStat.$inferInsert

const inputKeys = [
  "model-day",
  "model-week",
  "model-provider-model-day",
  "model-provider-model-week",
  "provider-day",
  "provider-week",
  "geo-day",
  "geo-week",
  "geo-continent-day",
  "geo-continent-week",
] as const satisfies ImportKey[]

if (import.meta.main) await main()

async function main() {
  const command = process.argv[2]
  if (command === "queries") return printQueries(process.argv.slice(3))
  if (command === "import") return importFiles(process.argv.slice(3))
  usage()
}

function printQueries(args: string[]) {
  const flags = parseFlags(args)
  const periodEnd = parseDateFlag(flags, "period-end") ?? defaultPeriodEnd()
  const days = parseIntegerFlag(flags, "days") ?? DEFAULT_DAYS
  const limit = parseIntegerFlag(flags, "limit") ?? 1000
  const dailyStart = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate() - days + 1),
  )
  const weekStart = syncWeekStart(periodEnd)

  console.log(
    JSON.stringify(
      {
        period_end: periodEnd.toISOString(),
        import_hint: `bun src/honeycomb-backfill.ts import --period-end ${periodEnd.toISOString()} ...`,
        daily: buildQuerySet(
          {
            start_time: Math.floor(dailyStart.getTime() / 1000),
            end_time: Math.floor(periodEnd.getTime() / 1000),
            granularity: DAY_MS / 1000,
          },
          limit,
        ),
        week: buildQuerySet(
          {
            start_time: Math.floor(weekStart.getTime() / 1000),
            end_time: Math.floor(periodEnd.getTime() / 1000),
          },
          limit,
        ),
      },
      null,
      2,
    ),
  )
}

async function importFiles(args: string[]) {
  const opts = parseImportOptions(args)
  const providerModelLookup = new Map([
    ...(await lookupRows(opts.files["model-provider-model-day"], "day", opts, modelProviderModelLookup)),
    ...(await lookupRows(opts.files["model-provider-model-week"], "week", opts, modelProviderModelLookup)),
  ])
  const continentLookup = new Map([
    ...(await lookupRows(opts.files["geo-continent-day"], "day", opts, geoContinentLookup)),
    ...(await lookupRows(opts.files["geo-continent-week"], "week", opts, geoContinentLookup)),
  ])
  const modelRows = modelRowsFromAggregates([
    ...(await metricRows(opts.files["model-day"], "day", opts, (row, base) => ({
      ...base,
      provider: provider(row),
      model: model(row),
      provider_model: providerModelLookup.get(lookupKey(base, provider(row), model(row))) ?? providerModel(row),
    }))),
    ...(await metricRows(opts.files["model-week"], "week", opts, (row, base) => ({
      ...base,
      provider: provider(row),
      model: model(row),
      provider_model: providerModelLookup.get(lookupKey(base, provider(row), model(row))) ?? providerModel(row),
    }))),
  ])
  const providerRows = providerRowsFromAggregates([
    ...(await metricRows(opts.files["provider-day"], "day", opts, (row, base) => ({
      ...base,
      provider: provider(row),
    }))),
    ...(await metricRows(opts.files["provider-week"], "week", opts, (row, base) => ({
      ...base,
      provider: provider(row),
    }))),
  ])
  const geoRows = geoRowsFromAggregates([
    ...(await metricRows(opts.files["geo-day"], "day", opts, (row, base) => ({
      ...base,
      country: country(row),
      continent: continentLookup.get(lookupKey(base, country(row))) ?? continent(row),
    }))),
    ...(await metricRows(opts.files["geo-week"], "week", opts, (row, base) => ({
      ...base,
      country: country(row),
      continent: continentLookup.get(lookupKey(base, country(row))) ?? continent(row),
    }))),
  ])

  console.log(
    JSON.stringify(
      {
        modelRows: modelRows.length,
        providerRows: providerRows.length,
        geoRows: geoRows.length,
        dryRun: opts.dryRun,
      },
      null,
      2,
    ),
  )

  if (opts.dryRun) return
  if (!opts.databaseUrl) fail("DATABASE_URL is required unless --dry-run is set")

  const db = drizzle({ client: new Client({ url: opts.databaseUrl }) })
  await upsertModelRows(db, modelRows)
  await upsertProviderRows(db, providerRows)
  await upsertGeoRows(db, geoRows)
}

function buildQuerySet(timing: Timing, limit: number) {
  return {
    model: metricQuery(["stat_tier", "stat_provider", "model"], timing, limit),
    model_provider_model: lookupQuery(["stat_tier", "stat_provider", "model", "provider.model"], timing, limit),
    provider: metricQuery(["stat_tier", "stat_provider"], timing, limit),
    geo: metricQuery(["stat_tier", "stat_country"], timing, limit),
    geo_continent: lookupQuery(["stat_tier", "stat_country", "cf.continent"], timing, limit),
  }
}

function metricQuery(breakdowns: string[], timing: Timing, limit: number) {
  return {
    ...timing,
    breakdowns,
    calculated_fields: [...commonCalculatedFields(), ...metricCalculatedFields()],
    calculations: [
      { op: "COUNT_DISTINCT", column: "session", name: "sessions" },
      { op: "COUNT", name: "requests" },
      { op: "SUM", column: "tokens.input", name: "input_tokens" },
      { op: "SUM", column: "tokens.output", name: "output_tokens" },
      { op: "SUM", column: "tokens.reasoning", name: "reasoning_tokens" },
      { op: "SUM", column: "tokens.cache_read", name: "cache_read_tokens" },
      { op: "SUM", column: "stat_tokens_total", name: "total_tokens" },
      { op: "SUM", column: "stat_cost_input_microcents", name: "input_cost_microcents" },
      { op: "SUM", column: "stat_cost_output_microcents", name: "output_cost_microcents" },
      { op: "SUM", column: "stat_cost_total_microcents", name: "total_cost_microcents" },
      { op: "AVG", column: "duration", name: "avg_duration_ms" },
      { op: "P50", column: "duration", name: "p50_duration_ms" },
      { op: "P95", column: "duration", name: "p95_duration_ms" },
      { op: "AVG", column: "time_to_first_byte", name: "avg_ttfb_ms" },
      { op: "P50", column: "time_to_first_byte", name: "p50_ttfb_ms" },
      { op: "P95", column: "time_to_first_byte", name: "p95_ttfb_ms" },
      { op: "AVG", column: "stat_output_tps", name: "avg_output_tps" },
      { op: "SUM", column: "stat_success", name: "success_count" },
      { op: "SUM", column: "stat_error", name: "error_count" },
      { op: "COUNT", name: "sample_count" },
    ],
    filters: commonFilters(),
    filter_combination: "AND",
    orders: [{ column: "stat_tokens_total", op: "SUM", order: "descending" }],
    limit,
  }
}

function lookupQuery(breakdowns: string[], timing: Timing, limit: number) {
  return {
    ...timing,
    breakdowns,
    calculated_fields: commonCalculatedFields(),
    calculations: [{ op: "COUNT", name: "requests" }],
    filters: commonFilters(),
    filter_combination: "AND",
    orders: [{ op: "COUNT", order: "descending" }],
    limit,
  }
}

function commonCalculatedFields() {
  return [
    {
      name: "stat_included_client",
      expression: `IF(OR(CONTAINS(COALESCE($user_agent, ""), "ai-sdk"), CONTAINS(COALESCE($user_agent, ""), "opencode")), 1, 0)`,
    },
    {
      name: "stat_tier",
      expression: `IF(EQUALS(COALESCE($source, ""), "lite"), "Go", OR(EQUALS(COALESCE($model, ""), "gpt-5-nano"), EQUALS(COALESCE($model, ""), "grok-code"), EQUALS(COALESCE($model, ""), "big-pickle"), ENDS_WITH(COALESCE($model, ""), "-free")), "Free", "Zen")`,
    },
    {
      name: "stat_provider",
      expression:
        `IF(STARTS_WITH(COALESCE($provider, ""), "minimax-plan"), "minimax-plan", STARTS_WITH(COALESCE($provider, ""), "zai-plan"), "zai-plan", STARTS_WITH(COALESCE($provider, ""), "azure-databricks"), "azure-databricks", REG_MATCH(COALESCE($provider, ""), ` +
        "`^azure[0-9]+`" +
        `), "azure-openai", COALESCE($provider, "unknown"))`,
    },
    { name: "stat_country", expression: `COALESCE($cf.country, "ZZ")` },
  ]
}

function metricCalculatedFields() {
  return [
    {
      name: "stat_tokens_total",
      expression: `SUM(COALESCE($tokens.cache_read, 0), COALESCE($tokens.cache_write_5m, 0), COALESCE($tokens.input, 0), COALESCE($tokens.output, 0))`,
    },
    {
      name: "stat_cost_input_microcents",
      expression: `COALESCE($cost.input.microcents, MUL($cost.input, 1000000), 0)`,
    },
    {
      name: "stat_cost_output_microcents",
      expression: `COALESCE($cost.output.microcents, MUL($cost.output, 1000000), 0)`,
    },
    {
      name: "stat_cost_total_microcents",
      expression: `COALESCE($cost.total.microcents, MUL($cost.total, 1000000), 0)`,
    },
    {
      name: "stat_output_tps",
      expression: `IF(LT(SUB($timestamp.last_byte, $timestamp.first_byte), 100), null, DIV(MUL($tokens.output, 1000), SUB($timestamp.last_byte, $timestamp.first_byte)))`,
    },
    { name: "stat_success", expression: `IF(AND(GTE($status, 200), LT($status, 400)), 1, 0)` },
    { name: "stat_error", expression: `IF(GTE($status, 400), 1, 0)` },
  ]
}

function commonFilters() {
  return [
    { column: "event_type", op: "=", value: "completions" },
    { column: "model", op: "exists" },
    { column: "model", op: "!=", value: "" },
    { column: "stat_included_client", op: "=", value: 1 },
  ]
}

function metricRows<T extends StatBaseAggregate>(
  file: string | undefined,
  grain: Grain,
  opts: ImportOptions,
  map: (row: RawRow, base: StatBaseAggregate) => T,
) {
  if (!file) return Promise.resolve([])
  return readRows(file).then((rows) => rows.map((row) => map(row, baseAggregate(row, grain, opts))))
}

function lookupRows(
  file: string | undefined,
  grain: Grain,
  opts: ImportOptions,
  map: (row: RawRow, grain: Grain, opts: ImportOptions) => readonly (readonly [string, string])[],
) {
  if (!file) return Promise.resolve([])
  return readRows(file).then((rows) =>
    Array.from(
      rows
        .flatMap((row) => map(row, grain, opts))
        .reduce((result, [key, value]) => {
          if (value && value > (result.get(key) ?? "")) result.set(key, value)
          return result
        }, new Map<string, string>()),
    ),
  )
}

function modelProviderModelLookup(row: RawRow, grain: Grain, opts: ImportOptions): [string, string][] {
  const base = basePeriod(row, grain, opts)
  const value = providerModel(row)
  if (!value) return []
  return [[lookupKey({ ...base, dataset: opts.dataset, tier: tier(row), grain }, provider(row), model(row)), value]]
}

function geoContinentLookup(row: RawRow, grain: Grain, opts: ImportOptions): [string, string][] {
  const base = basePeriod(row, grain, opts)
  const value = continent(row)
  if (!value) return []
  return [[lookupKey({ ...base, dataset: opts.dataset, tier: tier(row), grain }, country(row)), value]]
}

function baseAggregate(row: RawRow, grain: Grain, opts: ImportOptions): StatBaseAggregate {
  return {
    ...basePeriod(row, grain, opts),
    grain,
    dataset: opts.dataset,
    tier: tier(row),
    sessions: integer(row, "sessions", ["COUNT_DISTINCT(session)"]),
    requests: integer(row, "requests", ["COUNT", "COUNT()"]),
    input_tokens: integer(row, "input_tokens", ["SUM(tokens.input)", "SUM(tokens_input)"]),
    output_tokens: integer(row, "output_tokens", ["SUM(tokens.output)", "SUM(tokens_output)"]),
    reasoning_tokens: integer(row, "reasoning_tokens", ["SUM(tokens.reasoning)", "SUM(tokens_reasoning)"]),
    cache_read_tokens: integer(row, "cache_read_tokens", ["SUM(tokens.cache_read)", "SUM(tokens_cache_read)"]),
    total_tokens: integer(row, "total_tokens", ["SUM(stat_tokens_total)", "SUM(tokens)", "SUM(tokens_total)"]),
    input_cost_microcents: integer(row, "input_cost_microcents", ["SUM(stat_cost_input_microcents)"]),
    output_cost_microcents: integer(row, "output_cost_microcents", ["SUM(stat_cost_output_microcents)"]),
    total_cost_microcents: integer(row, "total_cost_microcents", ["SUM(stat_cost_total_microcents)"]),
    avg_duration_ms: nullableNumber(row, "avg_duration_ms", ["AVG(duration)", "AVG(duration_ms)"]),
    p50_duration_ms: nullableInteger(row, "p50_duration_ms", ["P50(duration)", "P50(duration_ms)"]),
    p95_duration_ms: nullableInteger(row, "p95_duration_ms", ["P95(duration)", "P95(duration_ms)"]),
    avg_ttfb_ms: nullableNumber(row, "avg_ttfb_ms", ["AVG(time_to_first_byte)", "AVG(ttfb_ms)"]),
    p50_ttfb_ms: nullableInteger(row, "p50_ttfb_ms", ["P50(time_to_first_byte)", "P50(ttfb_ms)"]),
    p95_ttfb_ms: nullableInteger(row, "p95_ttfb_ms", ["P95(time_to_first_byte)", "P95(ttfb_ms)"]),
    avg_output_tps: nullableNumber(row, "avg_output_tps", ["AVG(stat_output_tps)", "AVG(tps.output)"]),
    success_count: integer(row, "success_count", ["SUM(stat_success)"]),
    error_count: integer(row, "error_count", ["SUM(stat_error)"]),
    sample_count: integer(row, "sample_count", ["COUNT", "COUNT()"]),
  }
}

function basePeriod(row: RawRow, grain: Grain, opts: ImportOptions) {
  const period = periodFor(row, grain, opts)
  return { period_start: period.start, period_end: period.end }
}

function periodFor(row: RawRow, grain: Grain, opts: ImportOptions): Period {
  if (grain === "week") {
    const end = opts.periodEnd ?? parseTime(row)
    if (!end) fail("--period-end is required for week imports")
    return { start: opts.periodStart ?? syncWeekStart(end), end }
  }

  const time = parseTime(row)
  const start = time ? startOfUtcDay(time) : opts.periodStart
  if (!start) fail("daily imports require a time column or --period-start")
  return {
    start,
    end: opts.periodEnd && sameUtcDay(start, opts.periodEnd) ? opts.periodEnd : new Date(start.getTime() + DAY_MS),
  }
}

function modelRowsFromAggregates(aggregates: ModelAggregate[]) {
  return rankModelRows([
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "week").map(toModelRow), modelDimensionKey),
      modelDimensionKey,
    ),
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "day").map(toModelRow), modelDimensionKey),
      modelDimensionKey,
    ),
  ])
}

function providerRowsFromAggregates(aggregates: ProviderAggregate[]) {
  return rankRowsWithMarketShare([
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "week").map(toProviderRow), providerDimensionKey),
      providerDimensionKey,
    ),
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "day").map(toProviderRow), providerDimensionKey),
      providerDimensionKey,
    ),
  ])
}

function geoRowsFromAggregates(aggregates: GeoAggregate[]) {
  return rankRowsWithMarketShare([
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "week").map(toGeoRow), geoDimensionKey),
      geoDimensionKey,
    ),
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "day").map(toGeoRow), geoDimensionKey),
      geoDimensionKey,
    ),
  ])
}

function toModelRow(data: ModelAggregate): ModelStatRow {
  return { ...toStatBaseRow(data), provider: data.provider, model: data.model, provider_model: data.provider_model }
}

function toProviderRow(data: ProviderAggregate): ProviderStatRow {
  return { ...toStatBaseRow(data), provider: data.provider }
}

function toGeoRow(data: GeoAggregate): GeoStatRow {
  return { ...toStatBaseRow(data), country: data.country, continent: data.continent }
}

function rankModelRows(rows: ModelStatRow[]) {
  return Object.values(
    rows.reduce<Record<string, ModelStatRow[]>>((result, row) => {
      const key = statPeriodKey(row)
      result[key] = [...(result[key] ?? []), row]
      return result
    }, {}),
  ).flatMap((group) => {
    const tokenRanks = rankBy(group, (row) => row.total_tokens ?? 0)
    const requestRanks = rankBy(group, (row) => row.requests ?? 0)
    const costRanks = rankBy(group, (row) => row.total_cost_microcents ?? 0)
    return group.map((row) => ({
      ...row,
      rank_by_tokens: tokenRanks.get(row) ?? null,
      rank_by_requests: requestRanks.get(row) ?? null,
      rank_by_cost: costRanks.get(row) ?? null,
    }))
  })
}

function modelDimensionKey(row: ModelStatRow) {
  return [row.provider, row.model].join("\u0000")
}

function providerDimensionKey(row: ProviderStatRow) {
  return row.provider
}

function geoDimensionKey(row: GeoStatRow) {
  return row.country
}

function lookupKey(base: { grain: string; period_start: Date; dataset: string; tier: string }, ...dimension: string[]) {
  return [base.grain, base.period_start.toISOString(), base.dataset, base.tier, ...dimension].join("\u0000")
}

function tier(row: RawRow) {
  return normalizeTier(cell(row, ["stat_tier", "tier"]) || deriveTier(row))
}

function deriveTier(row: RawRow) {
  const source = cell(row, ["source"])
  const value = model(row)
  if (source === "lite") return "Go"
  if (FREE_MODELS.has(value) || value.endsWith("-free")) return "Free"
  return "Zen"
}

function provider(row: RawRow) {
  return normalizeProvider(cell(row, ["stat_provider", "provider"]) || "unknown")
}

function normalizeProvider(value: string) {
  if (value.startsWith("minimax-plan")) return "minimax-plan"
  if (value.startsWith("zai-plan")) return "zai-plan"
  if (value.startsWith("azure-databricks")) return "azure-databricks"
  if (/^azure[0-9]+/.test(value)) return "azure-openai"
  return value || "unknown"
}

function model(row: RawRow) {
  return cell(row, ["model"]) || "unknown"
}

function providerModel(row: RawRow) {
  return cell(row, ["provider.model", "provider_model"]) || ""
}

function country(row: RawRow) {
  return normalizeCountry(cell(row, ["stat_country", "cf.country", "cf_country", "country"]))
}

function continent(row: RawRow) {
  return cell(row, ["cf.continent", "cf_continent", "continent"]) || ""
}

function integer(row: RawRow, name: string, aliases: string[] = []) {
  return Math.round(number(row, name, aliases))
}

function nullableInteger(row: RawRow, name: string, aliases: string[] = []) {
  if (!hasCell(row, [name, ...aliases])) return null
  return Math.round(number(row, name, aliases))
}

function nullableNumber(row: RawRow, name: string, aliases: string[] = []) {
  if (!hasCell(row, [name, ...aliases])) return null
  return Number(number(row, name, aliases).toFixed(2))
}

function number(row: RawRow, name: string, aliases: string[] = []) {
  const value = Number(cell(row, [name, ...aliases]).replace(/,/g, ""))
  return Number.isFinite(value) ? value : 0
}

function hasCell(row: RawRow, names: string[]) {
  return names.some((name) => row[name] !== undefined && row[name] !== "")
}

function cell(row: RawRow, names: string[]) {
  const normalized = normalizedCells(row)
  return (
    names.flatMap((name) => [row[name], normalized.get(normalizeHeader(name))]).find((value) => value !== undefined) ??
    ""
  )
}

function normalizedCells(row: RawRow) {
  return new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]))
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function parseTime(row: RawRow) {
  const value = cell(row, ["time", "timestamp", "date", "datetime", "bucket"])
  if (!value) return undefined
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value)
  if (Number.isNaN(date.getTime())) fail(`Invalid time value: ${value}`)
  return date
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function syncWeekStart(periodEnd: Date) {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate() - 6))
}

function defaultPeriodEnd() {
  return new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000)
}

function sameUtcDay(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  )
}

async function readRows(file: string) {
  const text = await Bun.file(file).text()
  if (file.toLowerCase().endsWith(".json")) {
    const parsed: unknown = JSON.parse(text)
    return rowsFromJson(parsed)
  }
  return rowsFromCsv(text)
}

function rowsFromJson(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value.flatMap(rowFromUnknown)
  if (!isRecord(value)) fail("JSON imports must be an array of rows or an object with results/data/rows")

  const rows = [value.results, value.data, value.rows].flatMap((candidate) =>
    Array.isArray(candidate) ? candidate.flatMap(rowFromUnknown) : [],
  )
  if (rows.length === 0) fail("JSON import did not contain rows")
  return rows
}

function rowFromUnknown(value: unknown): RawRow[] {
  if (!isRecord(value)) return []
  const nested = isRecord(value.data) ? value.data : {}
  return [
    Object.fromEntries(
      Object.entries({ ...value, ...nested }).flatMap(([key, item]) => {
        if (key === "data") return []
        return [[key, cellValue(item)]]
      }),
    ),
  ]
}

function rowsFromCsv(text: string): RawRow[] {
  const [headers, ...rows] = csvRecords(text).filter((row) => row.some((value) => value.trim() !== ""))
  if (!headers) return []
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? ""])),
  )
}

function csvRecords(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        index++
        continue
      }
      if (char === '"') {
        quoted = false
        continue
      }
      field += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(field)
      field = ""
      continue
    }
    if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      continue
    }
    if (char === "\r") continue
    field += char
  }

  row.push(field)
  rows.push(row)
  return rows
}

function cellValue(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  return JSON.stringify(value) ?? ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function upsertModelRows(db: ReturnType<typeof drizzle>, rows: ModelStatRow[]) {
  await Promise.all(
    chunks(rows, UPSERT_CHUNK_SIZE).map((chunk) =>
      db
        .insert(modelStat)
        .values(chunk)
        .onDuplicateKeyUpdate({
          set: {
            period_end: inserted("period_end"),
            provider_model: inserted("provider_model"),
            sessions: inserted("sessions"),
            requests: inserted("requests"),
            input_tokens: inserted("input_tokens"),
            output_tokens: inserted("output_tokens"),
            reasoning_tokens: inserted("reasoning_tokens"),
            cache_read_tokens: inserted("cache_read_tokens"),
            total_tokens: inserted("total_tokens"),
            input_cost_microcents: inserted("input_cost_microcents"),
            output_cost_microcents: inserted("output_cost_microcents"),
            total_cost_microcents: inserted("total_cost_microcents"),
            avg_duration_ms: inserted("avg_duration_ms"),
            p50_duration_ms: inserted("p50_duration_ms"),
            p95_duration_ms: inserted("p95_duration_ms"),
            avg_ttfb_ms: inserted("avg_ttfb_ms"),
            p50_ttfb_ms: inserted("p50_ttfb_ms"),
            p95_ttfb_ms: inserted("p95_ttfb_ms"),
            avg_output_tps: inserted("avg_output_tps"),
            success_count: inserted("success_count"),
            error_count: inserted("error_count"),
            sample_count: inserted("sample_count"),
            rank_by_tokens: inserted("rank_by_tokens"),
            rank_by_requests: inserted("rank_by_requests"),
            rank_by_cost: inserted("rank_by_cost"),
          },
        }),
    ),
  )
}

async function upsertProviderRows(db: ReturnType<typeof drizzle>, rows: ProviderStatRow[]) {
  await Promise.all(
    chunks(rows, UPSERT_CHUNK_SIZE).map((chunk) =>
      db
        .insert(providerStat)
        .values(chunk)
        .onDuplicateKeyUpdate({
          set: {
            period_end: inserted("period_end"),
            sessions: inserted("sessions"),
            requests: inserted("requests"),
            input_tokens: inserted("input_tokens"),
            output_tokens: inserted("output_tokens"),
            reasoning_tokens: inserted("reasoning_tokens"),
            cache_read_tokens: inserted("cache_read_tokens"),
            total_tokens: inserted("total_tokens"),
            input_cost_microcents: inserted("input_cost_microcents"),
            output_cost_microcents: inserted("output_cost_microcents"),
            total_cost_microcents: inserted("total_cost_microcents"),
            avg_duration_ms: inserted("avg_duration_ms"),
            p50_duration_ms: inserted("p50_duration_ms"),
            p95_duration_ms: inserted("p95_duration_ms"),
            avg_ttfb_ms: inserted("avg_ttfb_ms"),
            p50_ttfb_ms: inserted("p50_ttfb_ms"),
            p95_ttfb_ms: inserted("p95_ttfb_ms"),
            avg_output_tps: inserted("avg_output_tps"),
            success_count: inserted("success_count"),
            error_count: inserted("error_count"),
            sample_count: inserted("sample_count"),
            market_share_tokens: inserted("market_share_tokens"),
            market_share_requests: inserted("market_share_requests"),
            market_share_sessions: inserted("market_share_sessions"),
            rank_by_tokens: inserted("rank_by_tokens"),
            rank_by_requests: inserted("rank_by_requests"),
            rank_by_sessions: inserted("rank_by_sessions"),
            rank_by_cost: inserted("rank_by_cost"),
          },
        }),
    ),
  )
}

async function upsertGeoRows(db: ReturnType<typeof drizzle>, rows: GeoStatRow[]) {
  await Promise.all(
    chunks(rows, UPSERT_CHUNK_SIZE).map((chunk) =>
      db
        .insert(geoStat)
        .values(chunk)
        .onDuplicateKeyUpdate({
          set: {
            period_end: inserted("period_end"),
            continent: inserted("continent"),
            sessions: inserted("sessions"),
            requests: inserted("requests"),
            input_tokens: inserted("input_tokens"),
            output_tokens: inserted("output_tokens"),
            reasoning_tokens: inserted("reasoning_tokens"),
            cache_read_tokens: inserted("cache_read_tokens"),
            total_tokens: inserted("total_tokens"),
            input_cost_microcents: inserted("input_cost_microcents"),
            output_cost_microcents: inserted("output_cost_microcents"),
            total_cost_microcents: inserted("total_cost_microcents"),
            avg_duration_ms: inserted("avg_duration_ms"),
            p50_duration_ms: inserted("p50_duration_ms"),
            p95_duration_ms: inserted("p95_duration_ms"),
            avg_ttfb_ms: inserted("avg_ttfb_ms"),
            p50_ttfb_ms: inserted("p50_ttfb_ms"),
            p95_ttfb_ms: inserted("p95_ttfb_ms"),
            avg_output_tps: inserted("avg_output_tps"),
            success_count: inserted("success_count"),
            error_count: inserted("error_count"),
            sample_count: inserted("sample_count"),
            market_share_tokens: inserted("market_share_tokens"),
            market_share_requests: inserted("market_share_requests"),
            market_share_sessions: inserted("market_share_sessions"),
            rank_by_tokens: inserted("rank_by_tokens"),
            rank_by_requests: inserted("rank_by_requests"),
            rank_by_sessions: inserted("rank_by_sessions"),
            rank_by_cost: inserted("rank_by_cost"),
          },
        }),
    ),
  )
}

function parseImportOptions(args: string[]): ImportOptions {
  const flags = parseFlags(args)
  const files = inputKeys.reduce<Partial<Record<ImportKey, string>>>((result, key) => {
    const value = flags.get(key)?.[0]
    if (!value) return result
    return { ...result, [key]: value }
  }, {})
  return {
    dataset: flags.get("dataset")?.[0] ?? "zen",
    databaseUrl: flags.get("database-url")?.[0] ?? process.env.DATABASE_URL,
    dryRun: flags.has("dry-run"),
    periodEnd: parseDateFlag(flags, "period-end"),
    periodStart: parseDateFlag(flags, "period-start"),
    files,
  }
}

function parseFlags(args: string[]) {
  const result = new Map<string, string[]>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`)
    const name = arg.slice(2)
    if (name === "dry-run") {
      result.set(name, ["true"])
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith("--")) fail(`Missing value for --${name}`)
    result.set(name, [...(result.get(name) ?? []), value])
    index++
  }
  return result
}

function parseDateFlag(flags: Map<string, string[]>, name: string) {
  const value = flags.get(name)?.[0]
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(`Invalid --${name}: ${value}`)
  return date
}

function parseIntegerFlag(flags: Map<string, string[]>, name: string) {
  const value = flags.get(name)?.[0]
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`Invalid --${name}: ${value}`)
  return parsed
}

function usage(): never {
  fail(`Usage:
  bun src/honeycomb-backfill.ts queries [--period-end ISO] [--days 60] [--limit 1000]
  bun src/honeycomb-backfill.ts import --period-end ISO [--dry-run] [--database-url URL] --model-day file.csv ...`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
