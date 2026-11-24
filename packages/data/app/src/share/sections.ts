// The share cards for the home page's sections, built from their data alone, so the page's share buttons and the
// embeds (routes/embed) draw the same card. With the formatters and colours the page's charts use too.
import countryCodesSource from "i18n-iso-countries/codes.json?raw"
import type {
  CacheRatioEntry,
  CountryEntry,
  MarketDay,
  SessionCostEntry,
  TokenCostEntry,
  UsagePoint,
} from "@opencode/data-core/domain/home"
import type { Period } from "../component/period-toggle"
import type { HomePageData } from "../lib/page-data"
import { formatCatalogLabName } from "../routes/model-catalog"
import type { ShareChart, ShareSeries } from "./card"
import type { ShareDraft } from "./share"

export const shareSections = [
  "top-models",
  "unique-users",
  "retention",
  "session-cost",
  "token-cost",
  "cache-ratio",
  "market-share",
  "geo-breakdown",
] as const

export type ShareSection = (typeof shareSections)[number]

// What a section's card depends on besides its data: the range its chart shows and, for Top Models, the leaderboard's.
export type ShareView = { period: Period; leaderboard: Period }

export const shareTitles: Record<ShareSection, string> = {
  "top-models": "Top Models",
  "unique-users": "Unique Users",
  retention: "Weekly Retention",
  "session-cost": "Session Cost",
  "token-cost": "Token Cost",
  "cache-ratio": "Cache Ratio",
  "market-share": "Market Share",
  "geo-breakdown": "Geographic Breakdown",
}

/** A section's card from the whole page's data, as its share button would make it with `view`. */
export function homeShareCard(section: ShareSection, data: HomePageData, view: ShareView) {
  const names = modelNames(data)
  if (section === "top-models") return topModelsCard(data.usage[view.period], data.leaderboard[view.leaderboard], view)
  if (section === "unique-users") return uniqueUsersCard(data.users[view.period], view.period, names)
  if (section === "retention") return retentionCard(data.retention)
  if (section === "session-cost") return sessionCostCard(data.sessionCost.slice(0, 16), names)
  if (section === "token-cost") return tokenCostCard(data.tokenCost.slice(0, 13), names)
  if (section === "cache-ratio") return cacheRatioCard(data.cacheRatio.slice(0, 16), names)
  if (section === "market-share") return marketShareCard(data.market[view.period], view.period)
  return geoCard(data.country.slice(0, 15), "Unknown")
}

export function topModelsCard(
  usage: UsagePoint[],
  leaderboard: HomePageData["leaderboard"]["weekly"],
  view: ShareView,
): ShareDraft | undefined {
  const leader = leaderboard[0]
  const chart = usageShareChart(usage, (value) => formatTokens(value), "All models")
  if (!chart || !leader) return undefined
  const when = view.leaderboard === "weekly" ? "in the past 7 days" : "yesterday"
  return {
    id: "top-models",
    title: shareTitles["top-models"],
    range: shareRange(chart, view.period),
    highlight: leader.name,
    headline: `${leader.name} led OpenCode usage ${when}, with ${formatBillions(leader.tokens)} tokens`,
    stat: { value: formatBillions(leader.tokens), label: `tokens for ${leader.name}, ${when}` },
    chart,
  }
}

export function uniqueUsersCard(
  users: UsagePoint[],
  period: Period,
  names: Map<string, string>,
): ShareDraft | undefined {
  const chart = usageShareChart(users, formatUsers, "All models")
  const top = chart && leadingSeries(chart)
  if (!chart || !top) return undefined
  const when = shareWhen(chart, period)
  const name = names.get(top.key) ?? top.label
  return {
    id: "unique-users",
    title: shareTitles["unique-users"],
    range: shareRange(chart, period),
    highlight: name,
    headline: `${name} had the most OpenCode users ${when}, with ${top.value}`,
    stat: { value: top.value, label: `OpenCode users on ${name}, ${when}` },
    chart,
  }
}

export function retentionCard(retention: HomePageData["retention"]): ShareDraft | undefined {
  const top = retention[0]
  if (!top) return undefined
  return {
    id: "retention",
    title: shareTitles.retention,
    range: "Week over week",
    highlight: top.name,
    headline: `${top.name} kept ${formatRetentionRate(top.rate)} of its OpenCode users from one week to the next`,
    stat: { value: formatRetentionRate(top.rate), label: `of ${top.name} users came back the next week` },
    chart: rankedShareChart(
      retention.map((item) => ({ label: item.model, value: formatRetentionRate(item.rate), fill: item.rate / 100 })),
    ),
  }
}

export function sessionCostCard(items: SessionCostEntry[], names: Map<string, string>): ShareDraft | undefined {
  const top = items[0]
  const max = Math.max(0, ...items.map((item) => item.cost)) || 1
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  return {
    id: "session-cost",
    title: shareTitles["session-cost"],
    range: "Average per session",
    highlight: name,
    headline: `An OpenCode session with ${name} costs ${formatSessionCost(top.cost)} on average`,
    stat: { value: formatSessionCost(top.cost), label: `average cost of an OpenCode session with ${name}` },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatSessionCost(item.cost), fill: item.cost / max })),
    ),
  }
}

export function tokenCostCard(items: TokenCostEntry[], names: Map<string, string>): ShareDraft | undefined {
  const top = items.find((item) => item.total > 0) ?? items[0]
  const max = Math.max(0, ...items.map((item) => item.total)) || 1
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  return {
    id: "token-cost",
    title: shareTitles["token-cost"],
    range: "USD per 1M output tokens",
    highlight: name,
    headline: `${name} has the lowest output price on OpenCode, at ${formatDollars(top.total)} per 1M tokens`,
    stat: { value: formatDollars(top.total), label: `per 1M output tokens for ${name}` },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatDollars(item.total), fill: item.total / max })),
    ),
  }
}

export function cacheRatioCard(items: CacheRatioEntry[], names: Map<string, string>): ShareDraft | undefined {
  const top = items[0]
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  return {
    id: "cache-ratio",
    title: shareTitles["cache-ratio"],
    range: "Share of input tokens",
    highlight: name,
    headline: `${name} served ${formatRatio(top.ratio)} of its input tokens from cache`,
    stat: { value: formatRatio(top.ratio), label: `of ${name} input tokens came from cache` },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatRatio(item.ratio), fill: item.ratio / 100 })),
    ),
  }
}

export function marketShareCard(days: MarketDay[], period: Period): ShareDraft | undefined {
  const chart = marketShareChart(days, getMarketAuthorOrder(days))
  const top = chart && leadingSeries(chart)
  if (!chart || !top) return undefined
  const when = shareWhen(chart, period)
  return {
    id: "market-share",
    title: shareTitles["market-share"],
    range: shareRange(chart, period),
    highlight: top.label,
    headline: `${top.label} served ${top.value} of OpenCode tokens ${when}`,
    stat: { value: top.value, label: `of OpenCode tokens went to ${top.label} models, ${when}` },
    chart,
  }
}

export function geoCard(countries: CountryEntry[], unknown: string): ShareDraft | undefined {
  const top = countries[0]
  if (!top) return undefined
  const max = Math.max(0, ...countries.map((country) => country.tokens)) || 1
  const name = (country: string) => formatCountryName(country, "en", unknown)
  return {
    id: "geo-breakdown",
    title: shareTitles["geo-breakdown"],
    range: "Past 2 months",
    highlight: name(top.country),
    headline: `${name(top.country)} sent the most OpenCode tokens in the past 2 months, ${formatGeoShare(top.share)} of the total`,
    stat: { value: formatGeoShare(top.share), label: `of OpenCode tokens came from ${name(top.country)}` },
    chart: rankedShareChart(
      countries.map((item) => ({
        label: name(item.country),
        value: `${formatGeoTokens(item.tokens)}  ${formatGeoShare(item.share)}`,
        fill: item.tokens / max,
      })),
    ),
  }
}

export const usageColors = [
  "#ed6aff",
  "#a684ff",
  "#7c86ff",
  "#51a2ff",
  "#00d3f2",
  "#00d5be",
  "#00bc7d",
  "#9ae600",
  "#ffb900",
  "#ff8904",
  "#ff6467",
]

export const marketColors = [
  "#ed6aff",
  "#a684ff",
  "#7c86ff",
  "#51a2ff",
  "#00d3f2",
  "#00d5be",
  "#00bc7d",
  "#9ae600",
  "#ffb900",
]

export type IsoCountryCode = readonly [string, string, string]

export const countryNumericIds = new Map(
  (JSON.parse(countryCodesSource) as IsoCountryCode[]).map((country) => [country[0], country[2]] as const),
)

export function usageTotal(point: UsagePoint) {
  return point.segments.reduce((sum, item) => sum + item.value, 0)
}

export function formatTokens(value: number) {
  if (value >= 1) return `${value.toFixed(value >= 10 ? 0 : 1)}T`
  return `${Math.round(value * 1000)}B`
}

export function formatUsers(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return new Intl.NumberFormat("en").format(Math.round(value))
}

export function formatRetentionRate(value: number) {
  return `${value.toFixed(1)}%`
}

export function formatBillions(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}T`
  return `${value}B`
}

export function getTopModelsSegmentOrder(data: UsagePoint[]) {
  return new Map(
    data.find((point) => point.segments.length > 0)?.segments.map((segment, index) => [segment.model, index]) ?? [],
  )
}

export function formatTopModelsMobileDate(label: string) {
  return label.split(" - ")[0] ?? label
}

export function countryNumericId(country: string) {
  return countryNumericIds.get(country.toUpperCase())?.padStart(3, "0")
}

export function formatCountryName(country: string, locale: string, unknown: string) {
  const code = country.toUpperCase()
  if (code === "ZZ") return unknown
  if (!countryNumericId(code)) return code
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code
}

export function formatGeoTokens(value: number) {
  return formatTrillions(value)
}

export function formatGeoShare(value: number) {
  return `${value.toFixed(value > 0 && value < 1 ? 1 : 0)}%`
}

export function getMarketAuthorOrder(data: MarketDay[]) {
  return getRankOrder(
    data.flatMap((day) => day.authors.map((author, index) => ({ key: author.author, value: author.tokens, index }))),
  )
}

export function getRankOrder(items: { key: string; value: number; index: number }[]) {
  return new Map<string, number>(
    Object.values(
      items.reduce<Record<string, { key: string; value: number; index: number }>>((result, item) => {
        result[item.key] = {
          key: item.key,
          value: (result[item.key]?.value ?? 0) + item.value,
          index: Math.min(result[item.key]?.index ?? item.index, item.index),
        }
        return result
      }, {}),
    )
      .toSorted((a, b) => b.value - a.value || a.index - b.index || a.key.localeCompare(b.key))
      .map((item, index) => [item.key, index] as const),
  )
}

export function formatTrillions(value: number) {
  if (value === 0) return "0"
  if (value < 0.001) return `${Number((value * 1_000_000).toFixed(value >= 0.00001 ? 0 : 1))}M`
  if (value < 1) return `${Number((value * 1_000).toFixed(value >= 0.01 ? 0 : 1))}B`
  return `${value.toFixed(value >= 10 ? 0 : 1)}T`
}

export function marketDateParts(label: string) {
  const [start, end] = label.split(" - ")
  return { start: start ?? label, end: end ?? start ?? label }
}

export function getRankColor(
  key: string,
  fallbackIndex: number,
  order: Map<string, number>,
  colors: readonly string[],
) {
  return colors[order.get(key) ?? fallbackIndex] ?? "var(--stats-text)"
}

export function formatRatio(value: number) {
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`
}

export function formatDollars(value: number) {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
}

export function formatSessionCost(value: number) {
  return `$${value.toFixed(4)}`
}

// Share cards (share/card.ts) leave out the last bucket, which is still filling in, show the six leading series and
// fold the rest into Other, as the site's colours rank them.
export const shareSeriesLimit = 6

export const shareOtherColor = "#6b6b6b"

export function usageShareChart(data: UsagePoint[], format: (value: number) => string, total: string) {
  const points = data.length > 1 ? data.slice(0, -1) : data
  const order = getTopModelsSegmentOrder(points)
  const keys = [...order.keys()].filter((key) => key !== "Other").slice(0, shareSeriesLimit)
  return stackedShareChart(
    points.map((point) => ({
      label: formatTopModelsMobileDate(point.date),
      values: new Map(point.segments.map((segment) => [segment.model, segment.value])),
    })),
    keys.map((key) => ({ key, label: key, color: getRankColor(key, 0, order, usageColors) })),
    format,
    false,
    total,
  )
}

export function marketShareChart(data: MarketDay[], order: Map<string, number>) {
  const days = data.length > 1 ? data.slice(0, -1) : data
  const keys = [...order.keys()].filter((key) => key !== "Other").slice(0, shareSeriesLimit)
  return stackedShareChart(
    days.map((day) => ({
      label: marketDateParts(day.date).start,
      values: new Map(day.authors.map((author) => [author.author, author.share])),
    })),
    keys.map((key) => ({
      key,
      label: formatCatalogLabName(key),
      color: getRankColor(key, 0, order, marketColors),
    })),
    (value) => `${value.toFixed(1)}%`,
    true,
    "All labs",
  )
}

export function stackedShareChart(
  columns: { label: string; values: Map<string, number> }[],
  named: Omit<ShareSeries, "value">[],
  format: (value: number) => string,
  normalized: boolean,
  total: string,
): Extract<ShareChart, { kind: "stacked" }> | undefined {
  if (columns.length === 0 || named.length === 0) return undefined
  const keys = new Set(named.map((item) => item.key))
  const rows = columns.map((column) => {
    const values = named.map((item) => column.values.get(item.key) ?? 0)
    const other = [...column.values].reduce((sum, [key, value]) => (keys.has(key) ? sum : sum + value), 0)
    return { label: column.label, values: [...values, other] }
  })
  const last = rows.at(-1)?.values ?? []
  return {
    kind: "stacked",
    normalized,
    columns: rows,
    // The latest column's whole: its sum, or 100% when the columns are shares.
    total: {
      label: `${total}, ${rows.at(-1)?.label ?? ""}`,
      value: normalized ? "100%" : format(last.reduce((sum, value) => sum + value, 0)),
    },
    series: [...named, { key: "other", label: "Other", color: shareOtherColor }]
      .map((item, index) => ({ ...item, value: format(last[index] ?? 0) }))
      .filter((item, index) => item.key !== "other" || (last[index] ?? 0) > 0),
  }
}

export function rankedShareChart(rows: { label: string; value: string; fill: number }[]): ShareChart {
  return {
    kind: "ranked",
    rows: rows.map((row, index) => ({ ...row, rank: String(index + 1).padStart(2, "0") })),
  }
}

// Model display names by ID, for share card headlines; charts and lists elsewhere show IDs.
export function modelNames(data: HomePageData) {
  return new Map(
    [...data.leaderboard.weekly, ...data.leaderboard.daily, ...data.retention].map((entry) => [
      entry.model,
      entry.name,
    ]),
  )
}

// The named series with the most in the latest column.
export function leadingSeries(chart: Extract<ShareChart, { kind: "stacked" }>) {
  const last = chart.columns.at(-1)?.values ?? []
  return chart.series
    .map((item, index) => ({ item, value: last[index] ?? 0 }))
    .filter((entry) => entry.item.key !== "other")
    .toSorted((a, b) => b.value - a.value)[0]?.item
}

export function shareRange(chart: Extract<ShareChart, { kind: "stacked" }>, period: Period) {
  return period === "weekly" ? `Past ${chart.columns.length} weeks` : `Past ${chart.columns.length} days`
}

export function shareWhen(chart: Extract<ShareChart, { kind: "stacked" }>, period: Period) {
  const label = chart.columns.at(-1)?.label ?? ""
  return period === "weekly" ? `in the week of ${label}` : `on ${label}`
}
