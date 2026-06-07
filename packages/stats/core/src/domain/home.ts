import { Effect } from "effect"
import { DatabaseError } from "../database"
import { GeoStatRepo, type GeoStatMetric } from "./geo"
import { ModelStatRepo, type ModelStatMetric } from "./model"
import { ProviderStatRepo, type ProviderStatMetric } from "./provider"

export type UsageProduct = "All Users" | "Zen" | "Go" | "Enterprise"
export type TokenProduct = "Zen" | "Go" | "Enterprise"
export type UsageRange = "1D" | "1W" | "2W" | "1M" | "2M" | "3M" | "YTD" | "ALL"
export type UsagePoint = { date: string; segments: { model: string; value: number }[] }
export type MarketDay = { date: string; total: number; authors: { author: string; share: number; tokens: number }[] }
export type LeaderboardEntry = {
  model: string
  provider: string
  author: string
  tokens: number
  change: number
  rank: number
}
export type TokenCostEntry = { model: string; total: number; input: number; output: number; cached: number }
export type CacheRatioEntry = { model: string; ratio: number; cached: number; uncached: number; total: number }
export type SessionCostEntry = { model: string; cost: number; tokens: number }
export type CountryEntry = { country: string; continent: string; tokens: number; share: number; rank: number }
export type ModelUsagePoint = { date: string; tokens: number; sessions: number; cost: number }
export type ModelMixEntry = { label: string; tokens: number; share: number }
export type ModelProductEntry = { product: string; tokens: number; sessions: number; share: number }
export type ModelPeerEntry = {
  model: string
  provider: string
  author: string
  rank: number
  tokens: number
  share: number
  slug: string
}
export type LabUsageModelEntry = {
  model: string
  provider: string
  author: string
  tokens: number
  share: number
  slug: string
}
export type StatsModelData = {
  updatedAt: string | null
  model: string
  slug: string
  provider: string
  author: string
  rank: number
  previousRank: number | null
  totalModels: number
  tokenShare: number
  tokenChange: number
  totals: {
    sessions: number
    tokens: number
    cost: number
    tokensPerSession: number
    costPerSession: number
    costPerMillion: number
    cacheRatio: number
  }
  usage: ModelUsagePoint[]
  tokenMix: ModelMixEntry[]
  productMix: ModelProductEntry[]
  country: Record<UsageRange, CountryEntry[]>
  peers: ModelPeerEntry[]
}
export type StatsLabData = {
  updatedAt: string | null
  provider: string
  author: string
  tokenShare: number
  tokenChange: number
  totals: {
    sessions: number
    tokens: number
    models: number
  }
  usage: ModelUsagePoint[]
  models: LabUsageModelEntry[]
}
export type StatsHomeData = {
  updatedAt: string | null
  usage: Record<UsageProduct, Record<UsageRange, UsagePoint[]>>
  leaderboard: Record<UsageProduct, Record<UsageRange, LeaderboardEntry[]>>
  market: Record<UsageRange, MarketDay[]>
  tokenCost: Record<TokenProduct, TokenCostEntry[]>
  cacheRatio: Record<TokenProduct, CacheRatioEntry[]>
  sessionCost: Record<TokenProduct, SessionCostEntry[]>
  country: Record<UsageRange, CountryEntry[]>
}

const DAY_MS = 86_400_000
const TOKEN_SCALE = 1_000_000
const DOLLARS_PER_MICROCENT = 1 / 100_000_000
const METRIC_MODEL_LIMIT = 10
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

export const getStatsModelData: (
  model: string,
  provider?: string,
) => Effect.Effect<StatsModelData | null, DatabaseError, ModelStatRepo | GeoStatRepo> = Effect.fn("StatsModel.getData")(
  function* (model, provider) {
    const modelStats = yield* ModelStatRepo
    const geoStats = yield* GeoStatRepo
    const modelRows = yield* modelStats.listDaily()
    const normalized = modelRows.flatMap(normalizeStatRow)
    const resolvedModel = resolveModelName(model, normalized, provider)
    if (!resolvedModel) return null
    return buildStatsModelData(
      resolvedModel,
      modelRows,
      yield* geoStats.listDaily({
        model: resolvedModel,
        provider: resolveModelProvider(resolvedModel, normalized, provider),
      }),
      provider,
    )
  },
)

export const getStatsLabData: (provider: string) => Effect.Effect<StatsLabData | null, DatabaseError, ModelStatRepo> =
  Effect.fn("StatsLab.getData")(function* (provider) {
    const modelStats = yield* ModelStatRepo
    return buildStatsLabData(provider, yield* modelStats.listDaily())
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
    market: createRangeRecord((range) => buildMarketShare(providers, "Go", range, getWindow(range, earliest, latest))),
    tokenCost: createTokenProductRecord((product) =>
      buildTokenCost(normalized, product, getWindow("1W", earliest, latest)),
    ),
    cacheRatio: createTokenProductRecord((product) =>
      buildCacheRatio(normalized, product, getWindow("1W", earliest, latest)),
    ),
    sessionCost: createTokenProductRecord((product) =>
      buildSessionCost(normalized, product, getWindow("1W", earliest, latest)),
    ),
    country: createRangeRecord((range) => buildCountryStats(geo, getWindow(range, earliest, latest))),
  }
}

function buildStatsModelData(
  modelParam: string,
  modelRows: ModelStatMetric[],
  geoRows: GeoStatMetric[],
  providerParam?: string,
): StatsModelData | null {
  const normalized = modelRows.flatMap(normalizeStatRow)
  const geo = geoRows.flatMap(normalizeGeoRow)
  if (normalized.length === 0) return null

  const model = resolveModelName(modelParam, normalized, providerParam)
  if (!model) return null

  const modelScopedRows = normalized.filter((row) => row.model === model)
  const earliest = Math.min(...normalized.map((row) => row.periodStart))
  const latest = Math.max(...normalized.map((row) => row.periodStart))
  const latestUpdate = Math.max(...modelScopedRows.map((row) => row.updatedAt))
  const window = getWindow("2M", earliest, latest)
  const currentRows = rowsForProduct(modelScopedRows, "All Users", window.start, window.end)
  const previousRows = rowsForProduct(modelScopedRows, "All Users", window.previousStart, window.previousEnd)
  const current = combineRowsForModel(model, currentRows)
  const previous = combineRowsForModel(model, previousRows)
  const peers = aggregateByModelName(rowsForProduct(normalized, "All Users", window.start, window.end))
    .filter((item) => item.totalTokens > 0)
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
  const previousPeers = aggregateByModelName(
    rowsForProduct(normalized, "All Users", window.previousStart, window.previousEnd),
  )
    .filter((item) => item.totalTokens > 0)
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))
  const rank = Math.max(1, peers.findIndex((item) => item.model === model) + 1)
  const previousRankIndex = previousPeers.findIndex((item) => item.model === model)
  const totalTokens = peers.reduce((sum, item) => sum + item.totalTokens, 0)

  return {
    updatedAt: Number.isFinite(latestUpdate) ? new Date(latestUpdate).toISOString() : null,
    model,
    slug: modelSlug(model),
    provider: current.provider,
    author: formatProvider(current.provider),
    rank,
    previousRank: previousRankIndex >= 0 ? previousRankIndex + 1 : null,
    totalModels: peers.length,
    tokenShare: totalTokens > 0 ? round((current.totalTokens / totalTokens) * 100, 2) : 0,
    tokenChange: percentChange(current.totalTokens, previous.totalTokens),
    totals: {
      sessions: current.sessions,
      tokens: current.totalTokens,
      cost: round(microcentsToDollars(current.totalCostMicrocents), 2),
      tokensPerSession: current.sessions > 0 ? Math.round(current.totalTokens / current.sessions) : 0,
      costPerSession:
        current.sessions > 0 ? round(microcentsToDollars(current.totalCostMicrocents) / current.sessions, 4) : 0,
      costPerMillion: costPerMillion(current.totalCostMicrocents, current.totalTokens),
      cacheRatio:
        current.inputTokens + current.cacheReadTokens > 0
          ? round((current.cacheReadTokens / (current.inputTokens + current.cacheReadTokens)) * 100, 1)
          : 0,
    },
    usage: buildModelUsage(currentRows, window, "2M"),
    tokenMix: buildModelTokenMix(current),
    productMix: buildModelProductMix(modelScopedRows, window, current),
    country: createRangeRecord((range) => buildCountryStats(geo, getWindow(range, earliest, latest))),
    peers: buildModelPeers(peers, rank, totalTokens),
  }
}

function buildStatsLabData(providerParam: string, modelRows: ModelStatMetric[]): StatsLabData | null {
  const normalized = modelRows.flatMap(normalizeStatRow)
  if (normalized.length === 0) return null

  const provider = resolveProviderName(providerParam, normalized)
  if (!provider) return null

  const providerRows = normalized.filter((row) => providerMatches(row.provider, provider))
  if (providerRows.length === 0) return null

  const earliest = Math.min(...normalized.map((row) => row.periodStart))
  const latest = Math.max(...normalized.map((row) => row.periodStart))
  const latestUpdate = Math.max(...providerRows.map((row) => row.updatedAt))
  const window = getWindow("2M", earliest, latest)
  const currentRows = rowsForProduct(providerRows, "All Users", window.start, window.end)
  const previousRows = rowsForProduct(providerRows, "All Users", window.previousStart, window.previousEnd)
  const current = combineRowsForModel("", currentRows)
  const previous = combineRowsForModel("", previousRows)
  const allCurrent = aggregateByModel(rowsForProduct(normalized, "All Users", window.start, window.end))
  const totalTokens = allCurrent.reduce((sum, item) => sum + item.totalTokens, 0)
  const models = aggregateByModel(currentRows)
    .filter((item) => item.totalTokens > 0)
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))

  return {
    updatedAt: Number.isFinite(latestUpdate) ? new Date(latestUpdate).toISOString() : null,
    provider,
    author: formatProvider(provider),
    tokenShare: totalTokens > 0 ? round((current.totalTokens / totalTokens) * 100, 2) : 0,
    tokenChange: percentChange(current.totalTokens, previous.totalTokens),
    totals: {
      sessions: current.sessions,
      tokens: current.totalTokens,
      models: models.length,
    },
    usage: buildModelUsage(currentRows, window, "2M"),
    models: models.map((item) => ({
      model: item.model,
      provider: item.provider,
      author: formatProvider(item.provider),
      tokens: item.totalTokens,
      share: current.totalTokens > 0 ? round((item.totalTokens / current.totalTokens) * 100, 2) : 0,
      slug: modelSlug(item.model),
    })),
  }
}

function emptyStatsHomeData(): StatsHomeData {
  return {
    updatedAt: null,
    usage: createUsageProductRecord(() => createRangeRecord(() => [])),
    leaderboard: createUsageProductRecord(() => createRangeRecord(() => [])),
    market: createRangeRecord(() => []),
    tokenCost: createTokenProductRecord(() => []),
    cacheRatio: createTokenProductRecord(() => []),
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
        ...segmentTokens.map((item) => ({ model: item.model, value: round(item.tokens / 1_000_000_000_000, 4) })),
        { model: "Other", value: round(Math.max(totalTokens - knownTokens, 0) / 1_000_000_000_000, 4) },
      ],
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
    .slice(0, 18)
    .map((item, index) => ({
      model: item.model,
      provider: item.provider,
      author: formatProvider(item.provider),
      tokens: Math.round(item.totalTokens / 1_000_000_000),
      change: percentChange(item.totalTokens, previous.get(modelKey(item.provider, item.model)) ?? 0),
      rank: index + 1,
    }))
}

function buildMarketShare(rows: ProviderMetricRow[], product: UsageProduct, range: UsageRange, window: DateWindow) {
  return createBuckets(window, range).flatMap((bucket) => {
    const total = aggregateByProvider(rowsForProduct(rows, product, bucket.start, bucket.end)).toSorted(
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
    .filter((item) => item.tokens > 0 && item.country !== "AQ")
    .toSorted((a, b) => b.tokens - a.tokens)
  const totalTokens = countries.reduce((sum, item) => sum + item.tokens, 0)
  if (totalTokens === 0) return []

  return countries.map((item, index) => ({
    country: item.country,
    continent: item.continent,
    tokens: round(item.tokens / 1_000_000_000_000, 4),
    share: round((item.tokens / totalTokens) * 100, 1),
    rank: index + 1,
  }))
}

function buildTokenCost(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return topModelsByUsage(rows, product, window)
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
}

function buildCacheRatio(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return topModelsByUsage(rows, product, window)
    .flatMap((item) => {
      const total = item.inputTokens + item.cacheReadTokens
      if (total === 0) return []
      return [
        {
          model: item.model,
          ratio: round((item.cacheReadTokens / total) * 100, 1),
          cached: round(item.cacheReadTokens / 1_000_000_000, 1),
          uncached: round(item.inputTokens / 1_000_000_000, 1),
          total: round(total / 1_000_000_000, 1),
        },
      ]
    })
    .toSorted((a, b) => b.ratio - a.ratio || b.cached - a.cached)
}

function buildSessionCost(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return topModelsByUsage(rows, product, window)
    .flatMap((item) => {
      if (item.sessions === 0) return []
      const cost = round(microcentsToDollars(item.totalCostMicrocents) / item.sessions, 4)
      if (cost === 0) return []
      return [{ model: item.model, cost, tokens: Math.round(item.totalTokens / item.sessions) }]
    })
    .toSorted((a, b) => a.cost - b.cost)
}

function topModelsByUsage(rows: StatMetricRow[], product: TokenProduct, window: DateWindow) {
  return aggregateByModel(rowsForProduct(rows, product, window.start, window.end))
    .toSorted((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, METRIC_MODEL_LIMIT)
}

function buildModelUsage(rows: StatMetricRow[], window: DateWindow, range: UsageRange) {
  return createBuckets(window, range).map((bucket) => {
    const aggregate = combineRowsForModel(
      "",
      rows.filter((row) => row.periodStart >= bucket.start && row.periodStart < bucket.end),
    )
    return {
      date: bucket.label,
      tokens: aggregate.totalTokens,
      sessions: aggregate.sessions,
      cost: round(microcentsToDollars(aggregate.totalCostMicrocents), 2),
    }
  })
}

function buildModelTokenMix(aggregate: ModelAggregate): ModelMixEntry[] {
  const items = [
    { label: "Input", tokens: aggregate.inputTokens },
    { label: "Output", tokens: aggregate.outputTokens },
    { label: "Reasoning", tokens: aggregate.reasoningTokens },
    { label: "Cached", tokens: aggregate.cacheReadTokens },
  ].filter((item) => item.tokens > 0)
  const total = items.reduce((sum, item) => sum + item.tokens, 0)
  if (total === 0) return []
  return items.map((item) => ({ ...item, share: round((item.tokens / total) * 100, 1) }))
}

function buildModelProductMix(
  rows: StatMetricRow[],
  window: DateWindow,
  fallback: ModelAggregate,
): ModelProductEntry[] {
  const products = ["Go", "Zen", "Enterprise"] as const
  const items = products.flatMap((product) => {
    const aggregate = combineRowsForModel(
      fallback.model,
      rows.filter((row) => row.tier === product && row.periodStart >= window.start && row.periodStart < window.end),
    )
    if (aggregate.totalTokens === 0) return []
    return [{ product, tokens: aggregate.totalTokens, sessions: aggregate.sessions }]
  })
  const total = items.reduce((sum, item) => sum + item.tokens, 0)
  if (total > 0) return items.map((item) => ({ ...item, share: round((item.tokens / total) * 100, 1) }))
  if (fallback.totalTokens === 0) return []
  return [{ product: "All Users", tokens: fallback.totalTokens, sessions: fallback.sessions, share: 100 }]
}

function buildModelPeers(peers: ModelAggregate[], rank: number, totalTokens: number): ModelPeerEntry[] {
  const start = Math.max(0, Math.min(rank - 4, Math.max(peers.length - 7, 0)))
  return peers.slice(start, start + 7).map((item, index) => ({
    model: item.model,
    provider: item.provider,
    author: formatProvider(item.provider),
    rank: start + index + 1,
    tokens: item.totalTokens,
    share: totalTokens > 0 ? round((item.totalTokens / totalTokens) * 100, 2) : 0,
    slug: modelSlug(item.model),
  }))
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

function aggregateByModelName(rows: StatMetricRow[]) {
  return Object.values(
    rows.reduce<Record<string, ModelAggregate>>((result, row) => {
      result[row.model] = combineModelAggregate(result[row.model], row)
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

function combineRowsForModel(model: string, rows: StatMetricRow[]): ModelAggregate {
  const aggregate = rows.reduce<ModelAggregate | undefined>(
    (result, row) => combineModelAggregate(result, row),
    undefined,
  )
  if (aggregate) return { ...aggregate, model: model || aggregate.model }
  return {
    model,
    provider: "unknown",
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    inputCostMicrocents: 0,
    outputCostMicrocents: 0,
    totalCostMicrocents: 0,
  }
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
        : range === "2W"
          ? latest - 13 * DAY_MS
          : range === "1M"
            ? latest - 27 * DAY_MS
            : range === "2M"
              ? latest - 55 * DAY_MS
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
  const count =
    range === "1D"
      ? 1
      : range === "1W" || range === "2W" || range === "1M" || range === "2M" || range === "3M"
        ? Math.ceil(span / DAY_MS)
        : Math.max(1, Math.min(7, Math.ceil(span / DAY_MS)))
  const size = span / count
  return Array.from({ length: count }, (_, index) => {
    const start = window.start + index * size
    const end = index === count - 1 ? window.end : window.start + (index + 1) * size
    return { start, end, label: formatBucketLabel(start, end, range) }
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
    "2W": value("2W"),
    "1M": value("1M"),
    "2M": value("2M"),
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

function formatBucketLabel(start: number, _end: number, range: UsageRange) {
  const date = new Date(start)
  if (range === "YTD") return months[date.getUTCMonth()]
  if (range === "ALL")
    return date.getUTCFullYear() === new Date().getUTCFullYear()
      ? months[date.getUTCMonth()]
      : String(date.getUTCFullYear())
  return formatDay(start)
}

function formatDay(value: number) {
  const date = new Date(value)
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

function resolveModelName(modelParam: string, rows: StatMetricRow[], providerParam?: string) {
  const input = modelParam.trim()
  if (!input) return undefined
  const normalizedInput = input.toLowerCase()
  const inputSlug = modelSlug(input)
  const candidates = providerParam
    ? aggregateByModel(rows).filter((item) => providerMatches(item.provider, providerParam))
    : aggregateByModelName(rows)
  return candidates
    .filter((item) => item.model.toLowerCase() === normalizedInput || modelSlug(item.model) === inputSlug)
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model))[0]?.model
}

function resolveModelProvider(model: string, rows: StatMetricRow[], providerParam?: string) {
  return aggregateByModel(rows)
    .filter((item) => item.model === model && (!providerParam || providerMatches(item.provider, providerParam)))
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.provider.localeCompare(b.provider))[0]?.provider
}

function providerMatches(provider: string, providerParam: string) {
  return modelSlug(provider) === modelSlug(providerParam)
}

function resolveProviderName(providerParam: string, rows: StatMetricRow[]) {
  const input = providerParam.trim()
  if (!input) return undefined
  const inputSlug = modelSlug(input)
  return aggregateByModel(rows)
    .filter((item) => modelSlug(item.provider) === inputSlug)
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.provider.localeCompare(b.provider))[0]?.provider
}

export function modelSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
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
