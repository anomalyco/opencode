import { Client } from "@planetscale/database"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { drizzle } from "drizzle-orm/planetscale-serverless"
import { geoStat, modelStat, providerStat } from "./database/schema"
import { modelAuthor, normalizeInferenceModel } from "./domain/model-normalization"
import {
  chunks,
  collapseRows,
  inserted,
  isoWeekId,
  normalizeCountry,
  normalizeTier,
  periodKeyFor,
  rankBy,
  rankRowsWithMarketShare,
  startOfIsoWeek,
  startOfUtcDay,
  statPeriodKey,
  synthesizeAllTierRows,
  toStatBaseRow,
  type StatBaseAggregate,
} from "./domain/stat"

const DAY_MS = 86_400_000
const DEFAULT_UPSERT_CHUNK_SIZE = 100
const DEFAULT_TIERS = ["Go", "Free", "Paid"]
const FREE_MODELS = new Set(["gpt-5-nano", "grok-code", "big-pickle"])

type Grain = "day" | "week"
type MetricDimension = "model" | "provider" | "geo" | "geo-model"
type LookupDimension = "model-provider-model" | "geo-continent"
type ImportKey = `${MetricDimension | LookupDimension}-${Grain}`
type QuerySpec = {
  name: string
  importKey: ImportKey
  importFlag: `--${ImportKey}`
  query: ReturnType<typeof metricQuery>
}
type RawRow = Record<string, string>
type ImportOptions = {
  dataset: string
  databaseUrl: string | undefined
  directories: string[]
  dryRun: boolean
  periodStart: Date | undefined
  upsertChunkSize: number
  files: Partial<Record<ImportKey, string[]>>
}
type ModelAggregate = StatBaseAggregate & { provider: string; model: string; provider_model: string }
type ProviderAggregate = StatBaseAggregate & { provider: string }
type GeoAggregate = StatBaseAggregate & { provider: string; model: string; country: string; continent: string }
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
  "geo-model-day",
  "geo-model-week",
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
  const limit = parseIntegerFlag(flags, "limit") ?? 1000
  const tiers = parseListFlag(flags, "tiers") ?? DEFAULT_TIERS
  const queries = buildQueries(limit, tiers)
  const only = flags.get("only")?.[0]

  if (only) {
    const item = queries.find((query) => query.name === only)
    if (!item) fail(`Unknown --only ${only}. Expected one of: ${queries.map((query) => query.name).join(", ")}`)
    console.log(JSON.stringify(item.query, null, 2))
    return
  }

  console.log(
    JSON.stringify(
      {
        tiers,
        import_hint: "bun src/honeycomb-backfill.ts import --dir downloads",
        queries,
      },
      null,
      2,
    ),
  )
}

async function importFiles(args: string[]) {
  const parsed = parseImportOptions(args)
  const opts = { ...parsed, files: mergeFiles(parsed.files, await discoverFiles(parsed.directories)) }
  if (!inputKeys.some((key) => opts.files[key]?.length)) fail("No CSV or JSON import files were provided or discovered")
  const providerModelLookup = new Map([
    ...(await lookupRows(opts.files["model-provider-model-day"], "day", opts, modelProviderModelLookup)),
    ...(await lookupRows(opts.files["model-provider-model-week"], "week", opts, modelProviderModelLookup)),
  ])
  const continentLookup = new Map([
    ...(await lookupRows(opts.files["geo-continent-day"], "day", opts, geoContinentLookup)),
    ...(await lookupRows(opts.files["geo-continent-week"], "week", opts, geoContinentLookup)),
  ])
  const modelAggregates = [
    ...(await metricRows(opts.files["model-day"], "day", opts, (row, base) =>
      modelAggregate(row, base, providerModelLookup),
    )),
    ...(await metricRows(opts.files["model-week"], "week", opts, (row, base) =>
      modelAggregate(row, base, providerModelLookup),
    )),
  ]
  const modelRows = modelRowsFromAggregates(modelAggregates)
  const providerRows = providerRowsFromAggregates([
    ...(await metricRows(opts.files["provider-day"], "day", opts, (row, base) => ({
      ...base,
      provider: provider(row) ?? "unknown",
    }))),
    ...(await metricRows(opts.files["provider-week"], "week", opts, (row, base) => ({
      ...base,
      provider: provider(row) ?? "unknown",
    }))),
  ])
  const geoRows = geoRowsFromAggregates([
    ...(await metricRows(opts.files["geo-day"], "day", opts, (row, base) => ({
      ...base,
      provider: "all",
      model: "all",
      country: country(row),
      continent: continentLookup.get(lookupKey(base, country(row))) ?? continent(row),
    }))),
    ...(await metricRows(opts.files["geo-week"], "week", opts, (row, base) => ({
      ...base,
      provider: "all",
      model: "all",
      country: country(row),
      continent: continentLookup.get(lookupKey(base, country(row))) ?? continent(row),
    }))),
    ...(await metricRows(opts.files["geo-model-day"], "day", opts, (row, base) =>
      geoModelAggregate(row, base, continentLookup),
    )),
    ...(await metricRows(opts.files["geo-model-week"], "week", opts, (row, base) =>
      geoModelAggregate(row, base, continentLookup),
    )),
  ])

  console.log(
    JSON.stringify(
      {
        inputs: Object.fromEntries(
          inputKeys.flatMap((key) => (opts.files[key]?.length ? [[key, opts.files[key].length]] : [])),
        ),
        modelRows: modelRows.length,
        providerRows: providerRows.length,
        geoRows: geoRows.length,
        dryRun: opts.dryRun,
        upsertChunkSize: opts.upsertChunkSize,
      },
      null,
      2,
    ),
  )

  if (opts.dryRun) return
  if (!opts.databaseUrl) fail("DATABASE_URL is required unless --dry-run is set")

  const db = drizzle({ client: new Client({ url: opts.databaseUrl }) })
  await upsertModelRows(db, modelRows, opts.upsertChunkSize)
  await upsertProviderRows(db, providerRows, opts.upsertChunkSize)
  await upsertGeoRows(db, geoRows, opts.upsertChunkSize)
}

function buildQueries(limit: number, tiers: string[]): QuerySpec[] {
  const daily = tiers.flatMap((tier) => [
    querySpec(
      "model-day",
      tier,
      metricQuery(["date", "tier", "stat_provider", "stat_model"], limit, tierFilters(tier)),
    ),
    querySpec("provider-day", tier, metricQuery(["date", "tier", "stat_provider"], limit, tierFilters(tier))),
    querySpec("geo-day", tier, metricQuery(["date", "tier", "country", "continent"], limit, tierFilters(tier))),
    querySpec(
      "geo-model-day",
      tier,
      metricQuery(["date", "tier", "stat_provider", "stat_model", "country", "continent"], limit, tierFilters(tier)),
    ),
  ])
  const weekly = tiers.flatMap((tier) => [
    querySpec(
      "model-week",
      tier,
      metricQuery(["week", "tier", "stat_provider", "stat_model"], limit, tierFilters(tier)),
    ),
    querySpec("provider-week", tier, metricQuery(["week", "tier", "stat_provider"], limit, tierFilters(tier))),
    querySpec("geo-week", tier, metricQuery(["week", "tier", "country", "continent"], limit, tierFilters(tier))),
    querySpec(
      "geo-model-week",
      tier,
      metricQuery(["week", "tier", "stat_provider", "stat_model", "country", "continent"], limit, tierFilters(tier)),
    ),
  ])

  return [...daily, ...weekly]
}

function querySpec(importKey: ImportKey, tier: string, query: ReturnType<typeof metricQuery>) {
  return {
    name: `${importKey}-${queryNameSegment(tier)}`,
    importKey,
    importFlag: `--${importKey}` as const,
    query,
  }
}

function metricQuery(breakdowns: string[], limit: number, filters: ReturnType<typeof commonFilters> = []) {
  return {
    granularity: 0,
    breakdowns,
    calculations: [
      { op: "COUNT_DISTINCT", column: "session" },
      { op: "COUNT" },
      { op: "SUM", column: "tokens.input" },
      { op: "SUM", column: "tokens.output" },
      { op: "SUM", column: "tokens.reasoning" },
      { op: "SUM", column: "tokens.cache_read" },
      { op: "SUM", column: "tokens" },
      { op: "SUM", column: "cost.input.microcents" },
      { op: "SUM", column: "cost.output.microcents" },
      { op: "SUM", column: "cost.total.microcents" },
      { op: "AVG", column: "duration" },
      { op: "P50", column: "duration" },
      { op: "P95", column: "duration" },
      { op: "AVG", column: "time_to_first_byte" },
      { op: "P50", column: "time_to_first_byte" },
      { op: "P95", column: "time_to_first_byte" },
      { op: "AVG", column: "tps.output" },
    ],
    filters: [...commonFilters(), ...filters],
    filter_combination: "AND",
    orders: [{ column: "tokens", op: "SUM", order: "descending" }],
    havings: [],
    limit,
    formulas: [],
  }
}

function tierFilters(tier: string) {
  if (tier === "all") return []
  return [{ column: "tier", op: "=", value: tier }]
}

function queryNameSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "all"
  )
}

function commonFilters() {
  return [
    { column: "event_type", op: "=", value: "completions" },
    { column: "model", op: "exists" },
    { column: "model", op: "!=", value: "" },
    { column: "model", op: "!=", value: "alpha-gpt-next" },
  ]
}

function metricRows<T extends StatBaseAggregate>(
  files: string[] | undefined,
  grain: Grain,
  opts: ImportOptions,
  map: (row: RawRow, base: StatBaseAggregate) => T | T[],
) {
  if (!files) return Promise.resolve([])
  return readFiles(files).then((rows) => rows.flatMap((row) => map(row, baseAggregate(row, grain, opts))))
}

function lookupRows(
  files: string[] | undefined,
  grain: Grain,
  opts: ImportOptions,
  map: (row: RawRow, grain: Grain, opts: ImportOptions) => readonly (readonly [string, string])[],
) {
  if (!files) return Promise.resolve([])
  return readFiles(files).then((rows) =>
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

async function readFiles(files: string[]) {
  return (await Promise.all(files.map(readRows))).flat()
}

async function discoverFiles(directories: string[]) {
  const classified = await Promise.all(
    (await Promise.all(directories.map(filesInDirectory))).flat().map(async (file) => ({
      file,
      key: classifyRows(file, await readRows(file)),
    })),
  )
  return classified.reduce<Partial<Record<ImportKey, string[]>>>((result, item) => {
    return { ...result, [item.key]: [...(result[item.key] ?? []), item.file] }
  }, {})
}

async function filesInDirectory(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) return filesInDirectory(file)
        if (entry.isFile() && /\.(csv|json)$/i.test(entry.name)) return Promise.resolve([file])
        return Promise.resolve([])
      }),
    )
  ).flat()
}

function classifyRows(file: string, rows: RawRow[]): ImportKey {
  if (rows.length === 0) fail(`Cannot classify empty export: ${file}`)
  const headers = new Set(rows.flatMap((row) => Object.keys(row).map(normalizeHeader)))
  const grain: Grain = headers.has("date") ? "day" : "week"
  if (hasHeader(headers, ["country", "cf.country"])) {
    if (hasHeader(headers, ["model", "stat_model"]) && hasMetricHeaders(headers)) return `geo-model-${grain}`
    return hasMetricHeaders(headers) ? `geo-${grain}` : `geo-continent-${grain}`
  }
  if (hasHeader(headers, ["model", "stat_model"]))
    return hasMetricHeaders(headers) ? `model-${grain}` : `model-provider-model-${grain}`
  if (hasHeader(headers, ["provider", "provider.normalized", "stat_provider"])) return `provider-${grain}`
  fail(`Cannot classify export from columns in ${file}`)
}

function hasMetricHeaders(headers: Set<string>) {
  return ["sumtokens", "sumtokensinput", "inputtokens", "totaltokens", "avgduration", "countdistinctsession"].some(
    (header) => headers.has(header),
  )
}

function hasHeader(headers: Set<string>, names: string[]) {
  return names.some((name) => headers.has(normalizeHeader(name)))
}

function mergeFiles(left: Partial<Record<ImportKey, string[]>>, right: Partial<Record<ImportKey, string[]>>) {
  return inputKeys.reduce<Partial<Record<ImportKey, string[]>>>((result, key) => {
    const files = [...(left[key] ?? []), ...(right[key] ?? [])]
    if (files.length === 0) return result
    return { ...result, [key]: files }
  }, {})
}

function modelProviderModelLookup(row: RawRow, grain: Grain, opts: ImportOptions): [string, string][] {
  const base = basePeriod(row, grain, opts)
  const value = providerModel(row)
  const author = provider(row)
  if (!value || !author) return []
  return [[lookupKey({ ...base, dataset: opts.dataset, tier: tier(row), grain }, author, model(row)), value]]
}

function modelAggregate(
  row: RawRow,
  base: StatBaseAggregate,
  providerModelLookup: Map<string, string>,
): ModelAggregate[] {
  const author = provider(row)
  if (!author) return []

  return [
    {
      ...base,
      provider: author,
      model: model(row),
      provider_model: providerModelLookup.get(lookupKey(base, author, model(row))) ?? providerModel(row),
    },
  ]
}

function geoContinentLookup(row: RawRow, grain: Grain, opts: ImportOptions): [string, string][] {
  const base = basePeriod(row, grain, opts)
  const value = continent(row)
  if (!value) return []
  return [[lookupKey({ ...base, dataset: opts.dataset, tier: tier(row), grain }, country(row)), value]]
}

function geoModelAggregate(row: RawRow, base: StatBaseAggregate, continentLookup: Map<string, string>): GeoAggregate[] {
  const author = provider(row)
  if (!author) return []

  return [
    {
      ...base,
      provider: author,
      model: model(row),
      country: country(row),
      continent: continentLookup.get(lookupKey(base, country(row))) ?? continent(row),
    },
  ]
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
    input_cost_microcents: integer(row, "input_cost_microcents", [
      "SUM(cost.input.microcents)",
      "SUM(stat_cost_input_microcents)",
    ]),
    output_cost_microcents: integer(row, "output_cost_microcents", [
      "SUM(cost.output.microcents)",
      "SUM(stat_cost_output_microcents)",
    ]),
    total_cost_microcents: integer(row, "total_cost_microcents", [
      "SUM(cost.total.microcents)",
      "SUM(stat_cost_total_microcents)",
    ]),
    avg_duration_ms: nullableNumber(row, "avg_duration_ms", ["AVG(duration)", "AVG(duration_ms)"]),
    p50_duration_ms: nullableInteger(row, "p50_duration_ms", ["P50(duration)", "P50(duration_ms)"]),
    p95_duration_ms: nullableInteger(row, "p95_duration_ms", ["P95(duration)", "P95(duration_ms)"]),
    avg_ttfb_ms: nullableNumber(row, "avg_ttfb_ms", ["AVG(time_to_first_byte)", "AVG(ttfb_ms)"]),
    p50_ttfb_ms: nullableInteger(row, "p50_ttfb_ms", ["P50(time_to_first_byte)", "P50(ttfb_ms)"]),
    p95_ttfb_ms: nullableInteger(row, "p95_ttfb_ms", ["P95(time_to_first_byte)", "P95(ttfb_ms)"]),
    avg_output_tps: nullableNumber(row, "avg_output_tps", ["AVG(tps.output)", "AVG(stat_output_tps)"]),
    success_count: integer(row, "success_count", ["SUM(success)", "SUM(is_success)", "SUM(stat_success)"]),
    error_count: integer(row, "error_count", ["SUM(error)", "SUM(is_error)", "SUM(stat_error)"]),
    sample_count: integer(row, "sample_count", ["COUNT", "COUNT()"]),
  }
}

function basePeriod(row: RawRow, grain: Grain, opts: ImportOptions) {
  return { period_key: periodKey(row, grain, opts) }
}

function periodKey(row: RawRow, grain: Grain, opts: ImportOptions) {
  if (grain === "week") {
    const week = parseWeek(row)
    if (week) return week
    fail("weekly imports require a week or period_key column")
  }

  const time = parseTime(row)
  const start = time ? startOfUtcDay(time) : opts.periodStart
  if (!start) fail("daily imports require a time column or --period-start")
  return periodKeyFor("day", start)
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
  return rankRowsWithMarketShare(
    [
      ...synthesizeAllTierRows(
        collapseRows(aggregates.filter((item) => item.grain === "week").map(toGeoRow), geoDimensionKey),
        geoDimensionKey,
      ),
      ...synthesizeAllTierRows(
        collapseRows(aggregates.filter((item) => item.grain === "day").map(toGeoRow), geoDimensionKey),
        geoDimensionKey,
      ),
    ],
    geoMarketShareKey,
  )
}

function toModelRow(data: ModelAggregate): ModelStatRow {
  return { ...toStatBaseRow(data), provider: data.provider, model: data.model, provider_model: data.provider_model }
}

function toProviderRow(data: ProviderAggregate): ProviderStatRow {
  return { ...toStatBaseRow(data), provider: data.provider }
}

function toGeoRow(data: GeoAggregate): GeoStatRow {
  return {
    ...toStatBaseRow(data),
    provider: data.provider,
    model: data.model,
    country: data.country,
    continent: data.continent,
  }
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
  return [row.provider, row.model, row.country].join("\u0000")
}

function geoMarketShareKey(row: GeoStatRow) {
  return [statPeriodKey(row), row.provider, row.model].join("\u0000")
}

function lookupKey(base: { grain: string; period_key: string; dataset: string; tier: string }, ...dimension: string[]) {
  return [base.grain, base.period_key, base.dataset, base.tier, ...dimension].join("\u0000")
}

function tier(row: RawRow) {
  return normalizeTier(cell(row, ["stat_tier", "tier"]) || deriveTier(row))
}

function deriveTier(row: RawRow) {
  const source = cell(row, ["source"])
  const value = model(row)
  if (source === "lite") return "Go"
  if (FREE_MODELS.has(value) || /-free(:global)?$/.test(rawModel(row))) return "Free"
  return "Zen"
}

function provider(row: RawRow) {
  return cell(row, ["stat_provider"]) || modelAuthor(model(row))
}

function model(row: RawRow) {
  return normalizeInferenceModel(cell(row, ["stat_model"]) || rawModel(row))
}

function rawModel(row: RawRow) {
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
  const value = cell(row, ["date", "time", "timestamp", "datetime", "bucket"])
  if (!value) return undefined
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(value)
  if (Number.isNaN(date.getTime())) fail(`Invalid time value: ${value}`)
  return date
}

function parseWeek(row: RawRow) {
  const value = cell(row, ["period_key", "week", "stat_week"])
  if (!value) return undefined

  const match = /^(\d{4})-W(\d{1,2})$/.exec(value)
  if (!match) fail(`Invalid week value: ${value}`)

  const year = Number(match[1])
  const week = Number(match[2])
  if (week < 1 || week > 53) fail(`Invalid week value: ${value}`)

  const start = new Date(startOfIsoWeek(new Date(Date.UTC(year, 0, 4))).getTime() + (week - 1) * 7 * DAY_MS)
  const id = `${year}-W${String(week).padStart(2, "0")}`
  if (isoWeekId(start) !== id) fail(`Invalid week value: ${value}`)
  return id
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

async function upsertModelRows(db: ReturnType<typeof drizzle>, rows: ModelStatRow[], chunkSize: number) {
  const batches = chunks(rows, chunkSize)
  console.log(JSON.stringify({ table: "model_stat", batches: batches.length, chunkSize }))
  for (const chunk of batches) {
    await db
      .insert(modelStat)
      .values(chunk)
      .onDuplicateKeyUpdate({
        set: {
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
      })
  }
}

async function upsertProviderRows(db: ReturnType<typeof drizzle>, rows: ProviderStatRow[], chunkSize: number) {
  const batches = chunks(rows, chunkSize)
  console.log(JSON.stringify({ table: "provider_stat", batches: batches.length, chunkSize }))
  for (const chunk of batches) {
    await db
      .insert(providerStat)
      .values(chunk)
      .onDuplicateKeyUpdate({
        set: {
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
      })
  }
}

async function upsertGeoRows(db: ReturnType<typeof drizzle>, rows: GeoStatRow[], chunkSize: number) {
  const batches = chunks(rows, chunkSize)
  console.log(JSON.stringify({ table: "geo_stat", batches: batches.length, chunkSize }))
  for (const chunk of batches) {
    await db
      .insert(geoStat)
      .values(chunk)
      .onDuplicateKeyUpdate({
        set: {
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
      })
  }
}

function parseImportOptions(args: string[]): ImportOptions {
  const flags = parseFlags(args)
  const files = inputKeys.reduce<Partial<Record<ImportKey, string[]>>>((result, key) => {
    const values = flags.get(key)
    if (!values) return result
    return { ...result, [key]: values }
  }, {})
  return {
    dataset: flags.get("dataset")?.[0] ?? "zen",
    databaseUrl: flags.get("database-url")?.[0] ?? process.env.DATABASE_URL,
    directories: flags.get("dir") ?? flags.get("directory") ?? [],
    dryRun: flags.has("dry-run"),
    periodStart: parseDateFlag(flags, "period-start"),
    upsertChunkSize: parseIntegerFlag(flags, "upsert-chunk-size") ?? DEFAULT_UPSERT_CHUNK_SIZE,
    files,
  }
}

function parseFlags(args: string[]) {
  const result = new Map<string, string[]>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`)
    const name = arg.slice(2)
    if (name === "dry-run" || name === "include-weekly") {
      result.set(name, ["true"])
      continue
    }
    const nextFlag = args.findIndex((value, valueIndex) => valueIndex > index && value.startsWith("--"))
    const values = args.slice(index + 1, nextFlag === -1 ? args.length : nextFlag)
    if (values.length === 0) fail(`Missing value for --${name}`)
    result.set(name, [...(result.get(name) ?? []), ...values])
    index += values.length
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

function parseListFlag(flags: Map<string, string[]>, name: string) {
  const value = flags.get(name)?.[0]
  if (!value) return undefined
  if (value === "all") return ["all"]
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function usage(): never {
  fail(`Usage:
  bun src/honeycomb-backfill.ts queries [--tiers Go,Free,Paid] [--limit 1000]
  bun src/honeycomb-backfill.ts import [--dry-run] [--upsert-chunk-size 100] [--database-url URL] --dir downloads
  bun src/honeycomb-backfill.ts import [--dry-run] [--upsert-chunk-size 100] [--database-url URL] --model-day file.csv [--model-day more.csv] ...`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
