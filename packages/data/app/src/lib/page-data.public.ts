// `vite dev` without the database variables: the home page reads the live site's public JSON
// (opencode.ai/data/index.json) and maps it back to HomePageData, so UI work needs no credentials.
// The JSON leaves out new models and lab paths, so those sections render empty.
import type { HomePageData } from "./page-data"

const source = "https://opencode.ai/data/index.json"
const DAY_MS = 86_400_000
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

type Series = { date: string; total: number; models: Record<string, number> }[]
type Market = { date: string; tokens: number; labs: { lab: string; tokens: number; sharePercent: number }[] }[]
type Leader = {
  rank: number
  model: string
  name: string
  lab: string
  page: string
  tokens: number
  changePercent?: number | null
}
type PublicHome = {
  updatedAt: string | null
  leaderboard: { pastWeek: Leader[]; pastDay: Leader[] }
  dailyTokens: Series
  dailyUniqueUsers: Series
  weeklyTokens: Series
  weeklyUniqueUsers: Series
  weeklyRetention: {
    rank: number | null
    model: string
    name: string
    page: string
    retentionPercent: number
    eligibleUserWeeks: number
    retainedUserWeeks: number
  }[]
  sessionCost: { model: string; costPerSessionUsd: number; tokensPerSession: number }[]
  tokenPricesUsdPer1M: { model: string; input: number; output: number; cachedInput: number }[]
  cacheRatio: { model: string; cachedInputPercent: number; cachedInputTokens: number; uncachedInputTokens: number }[]
  marketShare: Market
  weeklyMarketShare: Market
  countries: { rank: number; country: string; tokens: number; sharePercent: number }[]
}

export async function loadPublicHomePage(): Promise<HomePageData> {
  const json = (await (await fetch(source)).json()) as PublicHome
  const labs = new Map(json.leaderboard.pastWeek.map((entry) => [entry.model, entry.lab]))
  const leader = (entry: Leader) => ({
    model: entry.model,
    provider: entry.lab,
    author: entry.lab,
    tokens: Math.round(entry.tokens / 1e9),
    change: entry.changePercent ?? null,
    rank: entry.rank,
    path: path(entry.page),
    name: entry.name,
  })
  return {
    updatedAt: json.updatedAt,
    usage: { daily: series(json.dailyTokens, 1e12, 1), weekly: series(json.weeklyTokens, 1e12, 7) },
    users: { daily: series(json.dailyUniqueUsers, 1, 1), weekly: series(json.weeklyUniqueUsers, 1, 7) },
    leaderboard: { daily: json.leaderboard.pastDay.map(leader), weekly: json.leaderboard.pastWeek.map(leader) },
    market: { daily: market(json.marketShare, 1), weekly: market(json.weeklyMarketShare, 7) },
    tokenCost: json.tokenPricesUsdPer1M.map((entry) => ({
      model: entry.model,
      total: entry.output,
      input: entry.input,
      output: entry.output,
      cached: entry.cachedInput,
    })),
    cacheRatio: json.cacheRatio.map((entry) => ({
      model: entry.model,
      ratio: entry.cachedInputPercent,
      cached: entry.cachedInputTokens / 1e9,
      uncached: entry.uncachedInputTokens / 1e9,
      total: (entry.cachedInputTokens + entry.uncachedInputTokens) / 1e9,
    })),
    sessionCost: json.sessionCost.map((entry) => ({
      model: entry.model,
      cost: entry.costPerSessionUsd,
      tokens: entry.tokensPerSession,
    })),
    retention: json.weeklyRetention.map((entry) => ({
      model: entry.model,
      provider: labs.get(entry.model) ?? "",
      author: labs.get(entry.model) ?? "",
      rate: entry.retentionPercent,
      eligibleUserWeeks: entry.eligibleUserWeeks,
      retainedUserWeeks: entry.retainedUserWeeks,
      rank: entry.rank,
      path: path(entry.page),
      name: entry.name,
    })),
    country: json.countries.map((entry) => ({
      country: entry.country,
      continent: "",
      tokens: entry.tokens / 1e12,
      share: entry.sharePercent,
      rank: entry.rank,
    })),
    newModels: [],
    catalogLabs: [...new Set(json.leaderboard.pastWeek.map((entry) => entry.lab))],
    labPaths: {},
  }
}

function series(points: Series, scale: number, days: number) {
  return points.map((point) => ({
    ...period(point.date, days),
    segments: Object.entries(point.models).map(([model, value]) => ({ model, value: value / scale })),
  }))
}

function market(days: Market, length: number) {
  return days.map((day) => ({
    ...period(day.date, length),
    total: day.tokens / 1e12,
    authors: day.labs.map((lab) => ({ author: lab.lab, share: lab.sharePercent, tokens: lab.tokens / 1e12 })),
  }))
}

function period(start: string, days: number) {
  const end = new Date(Date.parse(start) + (days - 1) * DAY_MS).toISOString().slice(0, 10)
  return { date: days === 1 ? label(start) : `${label(start)} - ${label(end)}`, start, end }
}

function label(date: string) {
  const value = new Date(date)
  return `${months[value.getUTCMonth()]} ${value.getUTCDate()}`
}

function path(page: string) {
  return new URL(page).pathname.replace(/\/$/, "")
}
