import { Effect } from "effect"
import { DatabaseError } from "../database"
import { GeoStatRepo, type GeoStatMetric } from "./geo"
import { ModelStatRepo, type ModelStatMetric } from "./model"
import { ProviderStatRepo, type ProviderStatMetric } from "./provider"

export type UsageProduct = "All Users" | "Zen" | "Go" | "Enterprise"
export type TokenProduct = "Zen" | "Go" | "Enterprise"
export type UsageRange = "1D" | "1W" | "1M" | "3M" | "YTD" | "ALL"
export type UsagePoint = { date: string; segments: { model: string; value: number }[] }
export type MarketDay = { date: string; total: number; authors: { author: string; share: number; tokens: number }[] }
export type LeaderboardEntry = { model: string; author: string; tokens: number; change: number; rank: number }
export type TokenCostEntry = { model: string; total: number; input: number; output: number; cached: number }
export type SessionCostEntry = { model: string; cost: number; tokens: number }
export type CountryEntry = { country: string; continent: string; tokens: number; share: number; rank: number }
export type StatsHomeData = {
  updatedAt: string | null
  usage: Record<UsageProduct, Record<UsageRange, UsagePoint[]>>
  leaderboard: Record<UsageProduct, Record<UsageRange, LeaderboardEntry[]>>
  market: Record<UsageRange, MarketDay[]>
  tokenCost: Record<TokenProduct, TokenCostEntry[]>
  sessionCost: Record<TokenProduct, SessionCostEntry[]>
  country: Record<UsageRange, CountryEntry[]>
}

const DAY_MS = 86_400_000
const TOKEN_SCALE = 1_000_000
const DOLLARS_PER_MICROCENT = 1 / 100_000_000
const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const

type StatMetricRow = Omit<ModelStatMetric, "updatedAt"> & {
  periodStart: number
  updatedAt: number
}
type ProviderMetricRow = Omit<ProviderStatMetric, "updatedAt"> & {
  periodStart: number
  updatedAt: number
}
type GeoMetricRow = Omit<GeoStatMetric, "updatedAt"> & {
  periodStart: number
  updatedAt: number
}

type DateWindow = { start: number; end: number; previousStart: number; previousEnd: number }
type Bucket = { start: number; end: number; label: string }
type ModelAggregate = {
  model: string
  provider: string
  sessions: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  totalTokens: number
  inputCostMicrocents: number
  outputCostMicrocents: number
  totalCostMicrocents: number
}

export const getStatsHomeData: () => Effect.Effect<
  StatsHomeData,
  DatabaseError,
  ModelStatRepo | ProviderStatRepo | GeoStatRepo
> = Effect.fn("StatsHome.getData")(function* () {
  const modelStats = yield* ModelStatRepo
  const providerStats = yield* ProviderStatRepo
  const geoStats = yield* GeoStatRepo
  const [modelRows, providerRows, geoRows] = yield* Effect.all(
    [modelStats.listDaily(), providerStats.listDaily(), geoStats.listDaily()],
    { concurrency: "unbounded" },
  )
  return buildStatsHomeData(modelRows, providerRows, geoRows)
})

function buildStatsHomeData(
  modelRows: ModelStatMetric[],
  providerRows: ProviderStatMetric[],
  geoRows: GeoStatMetric[],
): StatsHomeData {
  const normalized = modelRows.flatMap(normalizeStatRow)
  const providers = providerRows.flatMap(normalizeProviderRow)
  const geo = geoRows.flatMap(normalizeGeoRow)
  const periods = [...normalized, ...providers, ...geo]
  if (periods.length === 0) return emptyStatsHomeData()

  const earliest = Math.min(...periods.map((row) => row.periodStart))
  const latest = Math.max(...periods.map((row) => row.periodStart))
  const latestUpdate = Math.max(...periods.map((row) => row.updatedAt))

  return {
    updatedAt: new Date(latestUpdate).toISOString(),
    usage: createUsageProductRecord((product) =>
      createRangeRecord((range) => buildUsagePoints(normalized, product, range, getWindow(range, earliest, latest))),
    ),
    leaderboard: createUsageProductRecord((product) =>
      createRangeRecord((range) => buildLeaderboard(normalized, product, getWindow(range, earliest, latest))),
    ),
    market: createRangeRecord((range) => buildMarketShare(providers, range, getWindow(range, earliest, latest))),
    tokenCost: createTokenProductRecord((product) =>
      buildTokenCost(normalized, product, getWindow("1W", earliest, latest)),
    ),
    sessionCost: createTokenProductRecord((product) =>
      buildSessionCost(normalized, product, getWindow("1W", earliest, latest)),
    ),
    country: createRangeRecord((range) => buildCountryStats(geo, getWindow(range, earliest, latest))),
  }
}

function emptyStatsHomeData(): StatsHomeData {
  return {
    updatedAt: null,
    usage: createUsageProductRecord(() => createRangeRecord(() => [])),
    leaderboard: createUsageProductRecord(() => createRangeRecord(() => [])),
    market: createRangeRecord(() => []),
    tokenCost: createTokenProductRecord(() => []),
    sessionCost: createTokenProductRecord(() => []),
    country: createRangeRecord(() => []),
  }
}

function buildUsagePoints(rows: StatMetricRow[], product: UsageProduct, range: UsageRange, window: DateWindow) {
  const windowRows = rowsForProduct(rows, product, window.start, window.end)
  const modelOrder = aggregateByModel(windowRows)
    .toSorted((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 6)
    .map((item) => ({ key: modelKey(item.provider, item.model), model: item.model }))

  return createBuckets(window, range).map((bucket) => {
    const bucketRows = aggregateByModel(rowsForProduct(rows, product, bucket.start, bucket.end))
    const byModel = new Map(bucketRows.map((item) => [modelKey(item.provider, item.model), item.totalTokens]))
    const segmentTokens = modelOrder.map((model) => ({ model: model.model, tokens: byModel.get(model.key) ?? 0 }))
    const knownTokens = segmentTokens.reduce((sum, item) => sum + item.tokens, 0)
    const totalTokens = bucketRows.reduce((sum, item) => sum + item.totalTokens, 0)
    return {
      date: bucket.label,
      segments: [
        ...segmentTokens.map((item) => ({ model: item.model, value: round(item.tokens / 1_000_000_000_000, 2) })),
        { model: "Other", value: round(Math.max(totalTokens - knownTokens, 0) / 1_000_000_000_000, 2) },
      ].filter((item) => item.value > 0),
    }
  })
}

function buildLeaderboard(rows: StatMetricRow[], product: UsageProduct, window: DateWindow) {
  const previous = new Map(
    aggregateByModel(rowsForProduct(rows, product, window.previousStart, window.previousEnd)).map((item) => [
      modelKey(item.provider, item.model),
      item.totalTokens,
    ]),
  )

  return aggregateByModel(rowsForProduct(rows, product, window.start, window.end))
    .toSorted((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 13)
    .map((item, index) => ({
      model: item.model,
      author: formatProvider(item.provider),
      tokens: Math.round(item.totalTokens / 1_000_000_000),
      change: percentChange(item.totalTokens, previous.get(modelKey(item.provider, item.model)) ?? 0),
      rank: index + 1,
    }))
}

function buildMarketShare(rows: ProviderMetricRow[], range: UsageRange, window: DateWindow) {
  return createBuckets(window, range).flatMap((bucket) => {
    const total = aggregateByProvider(rowsForProduct(rows, "All Users", bucket.start, bucket.end)).toSorted(
      (a, b) => b.tokens - a.tokens,
    )
    const totalTokens = total.reduce((sum, item) => sum + item.tokens, 0)
    if (totalTokens === 0) return []

    const authors = total.slice(0, 8)
    const knownTokens = authors.reduce((sum, item) => sum + item.tokens, 0)
    const withOther = [...authors, { provider: "Other", tokens: Math.max(totalTokens - knownTokens, 0) }].filter(
      (item) => item.tokens > 0,
    )

    return [
      {
        date: bucket.label,
        total: round(totalTokens / 1_000_000_000_000, 2),
        authors: withOther.map((item) => ({
          author: item.provider === "Other" ? "Other" : formatProvider(item.provider),
          share: round((item.tokens / totalTokens) * 100, 1),
          tokens: round(item.tokens / 1_000_000_000_000, 2),
        })),
      },
    ]
  })
}

function buildCountryStats(rows: GeoMetricRow[], window: DateWindow) {
  const countries = aggregateByCountry(rowsForProduct(rows, "All Users", window.start, window.end))
    .filter((item) => item.tokens > 0)
    .toSorted((a, b) => b.tokens - a.tokens)
  const totalTokens = countries.reduce((sum, item) => sum + item.tokens, 0)
  if (totalTokens === 0) return []

  return countries.slice(0, 16).map((item, index) => ({
    country: item.country,
    continent: item.continent,
    tokens: round(item.tokens / 1_000_000_000_000, 4),
    share: round((item.tokens / totalTokens) * 100, 1),
    rank: index + 1,
  }))
}

function buildTokenCost(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return aggregateByModel(rowsForProduct(rows, product, window.start, window.end))
    .flatMap((item) => {
      const total = costPerMillion(item.totalCostMicrocents, item.totalTokens)
      if (total === 0) return []
      return [
        {
          model: item.model,
          total,
          input: costPerMillion(item.inputCostMicrocents, item.inputTokens),
          output: costPerMillion(item.outputCostMicrocents, item.outputTokens + item.reasoningTokens),
          cached: costPerMillion(item.inputCostMicrocents, item.inputTokens + item.cacheReadTokens),
        },
      ]
    })
    .toSorted((a, b) => a.total - b.total)
    .slice(0, 17)
}

function buildSessionCost(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return aggregateByModel(rowsForProduct(rows, product, window.start, window.end))
    .flatMap((item) => {
      if (item.sessions === 0) return []
      const cost = round(microcentsToDollars(item.totalCostMicrocents) / item.sessions, 4)
      if (cost === 0) return []
      return [{ model: item.model, cost, tokens: Math.round(item.totalTokens / item.sessions) }]
    })
    .toSorted((a, b) => a.cost - b.cost)
    .slice(0, 17)
}

function rowsForProduct<T extends { periodStart: number; tier: string }>(
  rows: T[],
  product: UsageProduct,
  start: number,
  end: number,
) {
  const windowRows = rows.filter((row) => row.periodStart >= start && row.periodStart < end)
  if (product !== "All Users") return windowRows.filter((row) => row.tier === product)

  const allRows = windowRows.filter((row) => row.tier === "all")
  if (allRows.length > 0) return allRows
  return windowRows.filter((row) => row.tier !== "all")
}

function aggregateByModel(rows: StatMetricRow[]) {
  return Object.values(
    rows.reduce<Record<string, ModelAggregate>>((result, row) => {
      const key = modelKey(row.provider, row.model)
      result[key] = combineModelAggregate(result[key], row)
      return result
    }, {}),
  )
}

function aggregateByProvider(rows: ProviderMetricRow[]) {
  return Object.values(
    rows.reduce<Record<string, { provider: string; tokens: number }>>((result, row) => {
      result[row.provider] = {
        provider: row.provider,
        tokens: (result[row.provider]?.tokens ?? 0) + row.totalTokens,
      }
      return result
    }, {}),
  )
}

function aggregateByCountry(rows: GeoMetricRow[]) {
  return Object.values(
    rows.reduce<Record<string, { country: string; continent: string; tokens: number }>>((result, row) => {
      result[row.country] = {
        country: row.country,
        continent: result[row.country]?.continent || row.continent,
        tokens: (result[row.country]?.tokens ?? 0) + row.totalTokens,
      }
      return result
    }, {}),
  )
}

function combineModelAggregate(current: ModelAggregate | undefined, row: StatMetricRow): ModelAggregate {
  return {
    model: row.model,
    provider: row.provider,
    sessions: (current?.sessions ?? 0) + row.sessions,
    inputTokens: (current?.inputTokens ?? 0) + row.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + row.outputTokens,
    reasoningTokens: (current?.reasoningTokens ?? 0) + row.reasoningTokens,
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + row.cacheReadTokens,
    totalTokens: (current?.totalTokens ?? 0) + row.totalTokens,
    inputCostMicrocents: (current?.inputCostMicrocents ?? 0) + row.inputCostMicrocents,
    outputCostMicrocents: (current?.outputCostMicrocents ?? 0) + row.outputCostMicrocents,
    totalCostMicrocents: (current?.totalCostMicrocents ?? 0) + row.totalCostMicrocents,
  }
}

function getWindow(range: UsageRange, earliest: number, latest: number): DateWindow {
  const end = latest + DAY_MS
  const start = Math.max(
    earliest,
    range === "1D"
      ? latest
      : range === "1W"
        ? latest - 6 * DAY_MS
        : range === "1M"
          ? latest - 29 * DAY_MS
          : range === "3M"
            ? latest - 89 * DAY_MS
            : range === "YTD"
              ? Date.UTC(new Date(latest).getUTCFullYear(), 0, 1)
              : earliest,
  )
  const duration = end - start
  return { start, end, previousStart: start - duration, previousEnd: start }
}

function createBuckets(window: DateWindow, range: UsageRange): Bucket[] {
  const span = Math.max(window.end - window.start, DAY_MS)
  const count = Math.max(1, Math.min(7, Math.ceil(span / DAY_MS)))
  const size = span / count
  return Array.from({ length: count }, (_, index) => {
    const start = window.start + index * size
    const end = index === count - 1 ? window.end : window.start + (index + 1) * size
    return { start, end, label: formatBucketLabel(start, range) }
  })
}

function createUsageProductRecord<T>(value: (product: UsageProduct) => T): Record<UsageProduct, T> {
  return {
    "All Users": value("All Users"),
    Zen: value("Zen"),
    Go: value("Go"),
    Enterprise: value("Enterprise"),
  }
}

function createTokenProductRecord<T>(value: (product: TokenProduct) => T): Record<TokenProduct, T> {
  return {
    Zen: value("Zen"),
    Go: value("Go"),
    Enterprise: value("Enterprise"),
  }
}

function createRangeRecord<T>(value: (range: UsageRange) => T): Record<UsageRange, T> {
  return {
    "1D": value("1D"),
    "1W": value("1W"),
    "1M": value("1M"),
    "3M": value("3M"),
    YTD: value("YTD"),
    ALL: value("ALL"),
  }
}

function normalizeStatRow(row: ModelStatMetric): StatMetricRow[] {
  const periodStart = periodKeyTime(row.periodKey)
  const updatedAt = dateTime(row.updatedAt)
  if (!Number.isFinite(periodStart) || !Number.isFinite(updatedAt)) return []
  return [
    {
      ...row,
      periodStart,
      updatedAt,
      tier: normalizeTier(row.tier),
      provider: row.provider || "unknown",
      model: row.model || "unknown",
    },
  ]
}

function normalizeProviderRow(row: ProviderStatMetric): ProviderMetricRow[] {
  const periodStart = periodKeyTime(row.periodKey)
  const updatedAt = dateTime(row.updatedAt)
  if (!Number.isFinite(periodStart) || !Number.isFinite(updatedAt)) return []
  return [
    {
      ...row,
      periodStart,
      updatedAt,
      tier: normalizeTier(row.tier),
      provider: row.provider || "unknown",
    },
  ]
}

function normalizeGeoRow(row: GeoStatMetric): GeoMetricRow[] {
  const periodStart = periodKeyTime(row.periodKey)
  const updatedAt = dateTime(row.updatedAt)
  if (!Number.isFinite(periodStart) || !Number.isFinite(updatedAt)) return []
  return [
    {
      ...row,
      periodStart,
      updatedAt,
      tier: normalizeTier(row.tier),
      provider: row.provider || "all",
      model: row.model || "all",
      country: row.country || "ZZ",
      continent: row.continent || "",
    },
  ]
}

function normalizeTier(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === "paid" || normalized === "zen") return "Zen"
  if (normalized === "go") return "Go"
  if (normalized === "enterprise") return "Enterprise"
  if (normalized === "all") return "all"
  return value
}

function dateTime(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).getTime()
}

function periodKeyTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatBucketLabel(value: number, range: UsageRange) {
  const date = new Date(value)
  if (range === "YTD") return months[date.getUTCMonth()]
  if (range === "ALL")
    return date.getUTCFullYear() === new Date().getUTCFullYear()
      ? months[date.getUTCMonth()]
      : String(date.getUTCFullYear())
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`
}

function formatProvider(provider: string) {
  const known: Record<string, string> = {
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    google: "Google",
    minimax: "MiniMax",
    moonshot: "Moonshot",
    moonshotai: "Moonshot",
    nvidia: "NVIDIA",
    opencode: "opencode",
    openai: "OpenAI",
    qwen: "Qwen",
    tencent: "Tencent",
    xai: "xAI",
    xiaomi: "Xiaomi",
    zhipu: "Zhipu",
    zhipuai: "Zhipu",
  }
  const normalized = provider.toLowerCase().replace(/[^a-z0-9]/g, "")
  return known[normalized] ?? provider.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function modelKey(provider: string, model: string) {
  return `${provider}\u0000${model}`
}

function costPerMillion(costMicrocents: number, tokens: number) {
  if (tokens <= 0 || costMicrocents <= 0) return 0
  return round((microcentsToDollars(costMicrocents) / tokens) * TOKEN_SCALE, 2)
}

function microcentsToDollars(value: number) {
  return value * DOLLARS_PER_MICROCENT
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits))
}
