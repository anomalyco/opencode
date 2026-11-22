import {
  getStatsHomeData,
  getStatsLabData,
  getStatsModelData,
  getStatsModelsComparisonData,
  type MarketDay,
  type NewModelCandidate,
  type TokenCostEntry,
} from "@opencode/data-core/domain/home"
import { STEALTH_MODELS, statModel } from "@opencode/data-core/domain/model-normalization"
import { runStatsEffect } from "../stats-runtime"
import {
  catalogSlug,
  findModelCatalogEntry,
  findModelCatalogLab,
  loadModelCatalog,
  modelPagePath,
  type ModelCatalog,
} from "../routes/model-catalog"
import { resolveComparisonFamily } from "./comparison-pages"

const DAY_MS = 86_400_000
const NEW_MODEL_DAYS = 30
const NEW_MODEL_LIMIT = 8

export async function loadHomePage() {
  const [stats, catalog] = await Promise.all([runStatsEffect(getStatsHomeData()), loadModelCatalog()])
  const link = <T extends { model: string; provider: string }>(entry: T) => ({
    ...entry,
    path: modelPagePath(catalog, entry.provider, entry.model),
    name: findModelCatalogEntry(catalog, entry.model, entry.provider)?.name ?? entry.model,
  })
  return {
    updatedAt: stats.updatedAt,
    usage: stats.usage.Go["2M"],
    users: stats.users.Go["2M"],
    leaderboard: { daily: stats.leaderboard.Go["1D"].map(link), weekly: stats.leaderboard.Go["1W"].map(link) },
    market: stats.market["2M"],
    tokenCost: priceTokenCostFromCatalog(stats.tokenCost.Go, catalog),
    cacheRatio: stats.cacheRatio.Go,
    sessionCost: stats.sessionCost.Go,
    retention: stats.retention.map(link),
    country: stats.country,
    newModels: newModelsFromCatalog(stats.newModels, catalog).map(link),
    catalogLabs: catalog.labs.map((lab) => lab.id),
    labPaths: authorLabPaths(catalog, stats.market["2M"]),
  }
}

export type HomePageData = Awaited<ReturnType<typeof loadHomePage>>

export async function loadLabPage(labParam: string) {
  const [catalog, home] = await Promise.all([loadModelCatalog(), runStatsEffect(getStatsHomeData())])
  const lab = findModelCatalogLab(catalog, labParam) ?? null
  return {
    lab,
    labs: catalog.labs.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      models: entry.models.map((model) => ({ name: model.name })),
    })),
    market: home.market["2M"],
    stats: lab ? await runStatsEffect(getStatsLabData(lab.id)) : null,
    // Alias entries such as dated snapshots resolve to another model's page, so link to that page directly.
    modelPaths: Object.fromEntries(
      (lab?.models ?? []).map((model) => [model.id, modelPagePath(catalog, model.lab, model.slug)] as const),
    ),
  }
}

export type LabPageData = Awaited<ReturnType<typeof loadLabPage>>

export async function loadModelPage(labParam: string, modelParam: string) {
  const catalog = await loadModelCatalog()
  const entry = findModelCatalogEntry(catalog, modelParam, labParam) ?? null
  const lab = entry?.lab ?? labParam
  const model = entry?.slug ?? modelParam
  const stats = lab && model ? await runStatsEffect(getStatsModelData(model, lab)) : null
  return {
    catalog: {
      entry,
      stealthSpecs: entry ? null : (catalog.stealthSpecs[statModel(stats?.model ?? modelParam, undefined)] ?? null),
      labs: catalog.labs.map((item) => ({ id: item.id, name: item.name })),
      labModels:
        catalog.labs
          .find((item) => item.id === (entry?.lab ?? catalogSlug(labParam)))
          ?.models.map((item) => ({
            id: item.id,
            lab: item.lab,
            slug: item.slug,
            name: item.name,
            path: modelPagePath(catalog, item.lab, item.slug),
          })) ?? [],
    },
    stats: stats && {
      ...stats,
      peers: stats.peers.map((peer) => ({ ...peer, path: modelPagePath(catalog, peer.provider, peer.model) })),
    },
    path: modelPagePath(catalog, labParam, modelParam),
  }
}

export type ModelPageData = Awaited<ReturnType<typeof loadModelPage>>

export async function loadComparePage(params: string[]) {
  const catalog = await loadModelCatalog()
  const requests =
    params.length === 2
      ? params.flatMap((value) => {
          const family = resolveComparisonFamily(catalog, value)
          return family ? [{ lab: family.model.lab, slug: family.model.slug }] : []
        })
      : [
          { lab: params[0] ?? "", slug: params[1] ?? "" },
          { lab: params[2] ?? "", slug: params[3] ?? "" },
        ]
  if (requests.length !== 2) return { catalog, models: [] }
  const stats = await runStatsEffect(
    getStatsModelsComparisonData(requests.map((model) => ({ provider: model.lab, model: model.slug }))),
  )
  return {
    catalog,
    models: requests.map((request, index) => ({
      request,
      entry: findModelCatalogEntry(catalog, request.slug, request.lab) ?? null,
      stats: stats.models[index] ?? null,
    })),
  }
}

export type ComparePageData = Awaited<ReturnType<typeof loadComparePage>>

function priceTokenCostFromCatalog(data: TokenCostEntry[], catalog: ModelCatalog) {
  return data
    .flatMap((item) => {
      const cost = findModelCatalogEntry(catalog, item.model)?.cost
      if (!cost) return []
      return [
        {
          ...item,
          total: cost.output,
          input: cost.input,
          output: cost.output,
          cached: cost.cacheRead ?? cost.input,
        },
      ]
    })
    .toSorted((a, b) => a.total - b.total || a.model.localeCompare(b.model))
}

// A model is new when it was released in the past 30 days. Stealth models have no catalog entry, so their first day
// of usage stands in for the release date.
function newModelsFromCatalog(candidates: NewModelCandidate[], catalog: ModelCatalog) {
  const latest = candidates
    .flatMap((item) => item.daily.map((day) => day.date))
    .toSorted()
    .at(-1)
  if (!latest) return []
  const cutoff = new Date(Date.parse(latest) - (NEW_MODEL_DAYS - 1) * DAY_MS).toISOString().slice(0, 10)
  return candidates
    .flatMap((item) => {
      const entry = findModelCatalogEntry(catalog, item.model, item.provider)
      const releaseDate = entry?.releaseDate ?? (STEALTH_MODELS.has(item.model) ? item.firstSeen : undefined)
      if (!releaseDate || releaseDate < cutoff) return []
      // Count from launch: early access under the same name shows up before the release date.
      const launch = releaseDate > item.firstSeen ? releaseDate : item.firstSeen
      const daily = item.daily.filter((day) => day.date >= launch)
      return [
        {
          ...item,
          releaseDate,
          daysLive: Math.round((Date.parse(latest) - Date.parse(launch)) / DAY_MS) + 1,
          tokens: daily.reduce((sum, day) => sum + day.tokens, 0),
          sessions: daily.reduce((sum, day) => sum + day.sessions, 0),
          peakUsers: Math.max(0, ...daily.map((day) => day.users)),
          daily,
        },
      ]
    })
    .filter((item) => item.tokens > 0)
    .toSorted((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, NEW_MODEL_LIMIT)
}

function authorLabPaths(catalog: ModelCatalog, market: MarketDay[]) {
  return Object.fromEntries(
    [...new Set(market.flatMap((day) => day.authors.map((item) => item.author)))].flatMap((author) => {
      const lab = findModelCatalogLab(catalog, author)
      return lab ? [[author, `/data/${lab.id}`] as const] : []
    }),
  )
}
