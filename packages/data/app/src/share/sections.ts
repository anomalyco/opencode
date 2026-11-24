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
import { translate } from "../i18n"
import { tag, type Locale } from "../lib/language"
import type { HomePageData } from "../lib/page-data"
import { providerIconId } from "../lib/provider-icon"
import { formatCatalogLabName, isKnownCatalogLab } from "../routes/model-catalog"
import type { ShareChart, ShareSeries } from "./card"
import { shareTitle, type ShareSection, type ShareView } from "./embed"
import type { ShareDraft, ShareFocus } from "./share"

/** A section's card from the whole page's data, as its share button would make it with `view`. */
export function homeShareCard(locale: Locale, section: ShareSection, data: HomePageData, view: ShareView) {
  const names = modelNames(data)
  if (section === "top-models")
    return topModelsCard(locale, data.usage[view.period], data.leaderboard[view.leaderboard], view)
  if (section === "unique-users") return uniqueUsersCard(locale, data.users[view.period], view.period, names)
  if (section === "retention") return retentionCard(locale, data.retention)
  if (section === "session-cost") return sessionCostCard(locale, data.sessionCost.slice(0, 16), names)
  if (section === "token-cost") return tokenCostCard(locale, data.tokenCost.slice(0, 13), names)
  if (section === "cache-ratio") return cacheRatioCard(locale, data.cacheRatio.slice(0, 16), names)
  if (section === "market-share") return marketShareCard(locale, data.market[view.period], view.period)
  if (section === "leaderboard")
    return leaderboardCard(locale, data.leaderboard[view.leaderboard], view.leaderboard, data.catalogLabs)
  if (section === "comparison") return comparisonCard(locale, data, data.catalogLabs)
  return geoCard(locale, data.country.slice(0, 15))
}

type LeaderboardEntry = HomePageData["leaderboard"]["weekly"][number]

// The leaderboard's top three, as its featured cards show them.
export function leaderboardCard(
  locale: Locale,
  entries: LeaderboardEntry[],
  period: Period,
  catalogLabs: readonly string[],
): ShareDraft | undefined {
  const leader = entries[0]
  if (!leader) return undefined
  const when = translate(locale, period === "weekly" ? "share.when.past7Days" : "share.when.yesterday")
  const led = { name: leader.name, when, value: formatBillions(leader.tokens) }
  return {
    id: "leaderboard",
    locale,
    title: shareTitle(locale, "leaderboard"),
    range: translate(locale, period === "weekly" ? "share.range.past7Days" : "share.range.yesterday"),
    highlight: leader.name,
    headline: translate(locale, "share.led.headline", led),
    stat: { value: led.value, label: translate(locale, "share.led.stat", led) },
    chart: {
      kind: "podium",
      entries: entries.slice(0, 3).map((entry) => {
        const known = isKnownCatalogLab(entry.provider, catalogLabs)
        return {
          place: String(entry.rank).padStart(2, "0"),
          label: entry.model,
          provider: known ? formatCatalogLabName(entry.provider) : "",
          value: formatBillions(entry.tokens),
          change:
            entry.change === null
              ? translate(locale, "share.new")
              : entry.change > 0
                ? `+${entry.change}%`
                : `${entry.change}%`,
          tone: entry.change === null ? "new" : entry.change > 0 ? "up" : entry.change < 0 ? "down" : "flat",
          logo: known ? providerIconId(entry.author) : "synthetic",
        }
      }),
    },
    view: { period, leaderboard: period },
  }
}

// The top two models of the past week, head to head on every measure the page has for both.
export function comparisonCard(
  locale: Locale,
  data: HomePageData,
  catalogLabs: readonly string[],
): ShareDraft | undefined {
  const [first, second] = data.leaderboard.weekly
  if (!first || !second) return undefined
  const pair = [first, second]
  const latest = data.users.daily.at(-2) ?? data.users.daily.at(-1)
  const measures: {
    label: string
    read: (model: string) => number | undefined
    format: (value: number) => string
    lower?: boolean
  }[] = [
    {
      label: translate(locale, "share.comparison.tokens"),
      read: (model) => pair.find((item) => item.model === model)?.tokens,
      format: formatBillions,
    },
    {
      label: translate(locale, "share.comparison.dailyUsers"),
      read: (model) => latest?.segments.find((item) => item.model === model)?.value,
      format: formatUsers,
    },
    {
      label: translate(locale, "share.comparison.retention"),
      read: (model) => data.retention.find((item) => item.model === model)?.rate,
      format: formatRetentionRate,
    },
    {
      label: translate(locale, "share.comparison.sessionCost"),
      read: (model) => data.sessionCost.find((item) => item.model === model)?.cost,
      format: formatSessionCost,
      lower: true,
    },
    {
      label: translate(locale, "share.comparison.outputPrice"),
      read: (model) => data.tokenCost.find((item) => item.model === model)?.total,
      format: formatDollars,
      lower: true,
    },
    {
      label: translate(locale, "share.comparison.cache"),
      read: (model) => data.cacheRatio.find((item) => item.model === model)?.ratio,
      format: formatRatio,
    },
  ]
  const rows = measures.flatMap((measure) => {
    const values = pair.map((item) => measure.read(item.model))
    if (values.some((value) => value === undefined)) return []
    const [a, b] = values as [number, number]
    const max = Math.max(a, b) || 1
    const min = Math.min(a, b)
    const lead = a === b ? -1 : a < b === Boolean(measure.lower) ? 0 : 1
    const scores = measure.lower ? [a ? min / a : 1, b ? min / b : 1] : [a / max, b / max]
    return [
      { label: measure.label, values: [measure.format(a), measure.format(b)], fills: [a / max, b / max], scores, lead },
    ]
  })
  const ratio = first.tokens / Math.max(1, second.tokens)
  const served = { first: first.name, second: second.name, ratio: `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x` }
  return {
    id: "comparison",
    locale,
    title: shareTitle(locale, "comparison"),
    range: translate(locale, "share.range.past7Days"),
    highlight: first.name,
    headline: translate(locale, "share.comparison.headline", served),
    stat: { value: served.ratio, label: translate(locale, "share.comparison.stat", served) },
    chart: {
      kind: "versus",
      models: pair.map((entry) => {
        const known = isKnownCatalogLab(entry.provider, catalogLabs)
        return {
          label: entry.model,
          provider: known ? formatCatalogLabName(entry.provider) : "",
          logo: known ? providerIconId(entry.author) : "synthetic",
        }
      }),
      rows,
    },
  }
}

// `focus.day` is one column of the chart to share instead of the whole range: its headline, number and legend, the
// day broken down. `focus.lead` leads the card with the top model or with all tokens. A card's `variant` makes it
// again for another focus, for the editor's Date and Lead with rows.
export function topModelsCard(
  locale: Locale,
  usage: UsagePoint[],
  leaderboard: HomePageData["leaderboard"]["weekly"],
  view: ShareView,
  focus: ShareFocus = {},
): ShareDraft | undefined {
  const leader = leaderboard[0]
  const day = focus.day
  const chart = usageShareChart(
    locale,
    usage,
    (value) => formatTokens(value),
    translate(locale, "share.total.allModels"),
    day,
  )
  if (!chart || !leader) return undefined
  const variant = (next: ShareFocus) => topModelsCard(locale, usage, leaderboard, view, next)
  if (focus.lead === "total") {
    const sum =
      day === undefined
        ? formatTotalTokens(chart.columns.reduce((all, column) => all + column.values.reduce((a, b) => a + b, 0), 0))
        : chart.total.value
    const when =
      day === undefined
        ? translate(locale, view.period === "weekly" ? "share.when.pastWeeks" : "share.when.pastDays", {
            count: chart.columns.length,
          })
        : shareWhen(locale, chart, view.period)
    // Over the whole range the legend and the line under the chart add up the range too, to match the number.
    const ranged = (series: number) => chart.columns.reduce((all, column) => all + (column.values[series] ?? 0), 0)
    return {
      id: "top-models",
      locale,
      title: shareTitle(locale, "top-models"),
      range: day === undefined ? shareRange(locale, chart, view.period) : shareDate(locale, chart, view.period),
      headline: translate(locale, "share.total.headline", { value: sum, when }),
      stat: { value: sum, label: translate(locale, "share.total.stat", { when }) },
      chart:
        day === undefined
          ? {
              ...chart,
              series: chart.series.map((item, index) => ({ ...item, value: formatTotalTokens(ranged(index)) })),
              total: {
                label: translate(locale, view.period === "weekly" ? "share.total.pastWeeks" : "share.total.pastDays", {
                  label: translate(locale, "share.total.allModels"),
                  count: chart.columns.length,
                }),
                value: sum,
              },
            }
          : chart,
      view,
      variant,
    }
  }
  if (day !== undefined) {
    const top = leadingSeries(chart)
    if (!top) return undefined
    const name = leaderboard.find((entry) => entry.model === top.key)?.name ?? top.label
    const led = { name, when: shareWhen(locale, chart, view.period), value: top.value }
    return {
      id: "top-models",
      locale,
      title: shareTitle(locale, "top-models"),
      range: shareDate(locale, chart, view.period),
      highlight: name,
      headline: translate(locale, "share.led.headline", led),
      stat: { value: top.value, label: translate(locale, "share.led.stat", led) },
      chart,
      view,
      variant,
    }
  }
  const led = {
    name: leader.name,
    when: translate(locale, view.leaderboard === "weekly" ? "share.when.past7Days" : "share.when.yesterday"),
    value: formatBillions(leader.tokens),
  }
  return {
    id: "top-models",
    locale,
    title: shareTitle(locale, "top-models"),
    range: shareRange(locale, chart, view.period),
    highlight: leader.name,
    headline: translate(locale, "share.led.headline", led),
    stat: { value: led.value, label: translate(locale, "share.led.stat", led) },
    chart,
    view,
    variant,
  }
}

export function uniqueUsersCard(
  locale: Locale,
  users: UsagePoint[],
  period: Period,
  names: Map<string, string>,
  focus: ShareFocus = {},
): ShareDraft | undefined {
  const day = focus.day
  const chart = usageShareChart(locale, users, formatUsers, translate(locale, "share.total.allModels"), day)
  const top = chart && leadingSeries(chart)
  if (!chart || !top) return undefined
  const name = names.get(top.key) ?? top.label
  const had = { name, when: shareWhen(locale, chart, period), value: top.value }
  return {
    id: "unique-users",
    locale,
    title: shareTitle(locale, "unique-users"),
    range: day === undefined ? shareRange(locale, chart, period) : shareDate(locale, chart, period),
    highlight: name,
    headline: translate(locale, "share.users.headline", had),
    stat: { value: top.value, label: translate(locale, "share.users.stat", had) },
    chart,
    view: { period, leaderboard: "weekly" },
    // No Total: a person who used several models is in each of their rows, so the rows don't add up to people.
    variant: (next) => uniqueUsersCard(locale, users, period, names, { day: next.day }),
  }
}

export function retentionCard(locale: Locale, retention: HomePageData["retention"]): ShareDraft | undefined {
  const top = retention[0]
  if (!top) return undefined
  const kept = { name: top.name, rate: formatRetentionRate(top.rate) }
  return {
    id: "retention",
    locale,
    title: shareTitle(locale, "retention"),
    range: translate(locale, "share.range.weekOverWeek"),
    highlight: top.name,
    headline: translate(locale, "share.retention.headline", kept),
    stat: { value: kept.rate, label: translate(locale, "share.retention.stat", kept) },
    chart: rankedShareChart(
      retention.map((item) => ({ label: item.model, value: formatRetentionRate(item.rate), fill: item.rate / 100 })),
    ),
  }
}

export function sessionCostCard(
  locale: Locale,
  items: SessionCostEntry[],
  names: Map<string, string>,
): ShareDraft | undefined {
  const top = items[0]
  const max = Math.max(0, ...items.map((item) => item.cost)) || 1
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  const costs = { name, cost: formatSessionCost(top.cost) }
  return {
    id: "session-cost",
    locale,
    title: shareTitle(locale, "session-cost"),
    range: translate(locale, "share.range.perSession"),
    highlight: name,
    headline: translate(locale, "share.sessionCost.headline", costs),
    stat: { value: costs.cost, label: translate(locale, "share.sessionCost.stat", costs) },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatSessionCost(item.cost), fill: item.cost / max })),
    ),
  }
}

export function tokenCostCard(
  locale: Locale,
  items: TokenCostEntry[],
  names: Map<string, string>,
): ShareDraft | undefined {
  const top = items.find((item) => item.total > 0) ?? items[0]
  const max = Math.max(0, ...items.map((item) => item.total)) || 1
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  const price = { name, price: formatDollars(top.total) }
  return {
    id: "token-cost",
    locale,
    title: shareTitle(locale, "token-cost"),
    range: translate(locale, "share.range.outputPrice"),
    highlight: name,
    headline: translate(locale, "share.tokenCost.headline", price),
    stat: { value: price.price, label: translate(locale, "share.tokenCost.stat", price) },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatDollars(item.total), fill: item.total / max })),
    ),
  }
}

export function cacheRatioCard(
  locale: Locale,
  items: CacheRatioEntry[],
  names: Map<string, string>,
): ShareDraft | undefined {
  const top = items[0]
  if (!top) return undefined
  const name = names.get(top.model) ?? top.model
  const served = { name, ratio: formatRatio(top.ratio) }
  return {
    id: "cache-ratio",
    locale,
    title: shareTitle(locale, "cache-ratio"),
    range: translate(locale, "share.range.inputShare"),
    highlight: name,
    headline: translate(locale, "share.cache.headline", served),
    stat: { value: served.ratio, label: translate(locale, "share.cache.stat", served) },
    chart: rankedShareChart(
      items.map((item) => ({ label: item.model, value: formatRatio(item.ratio), fill: item.ratio / 100 })),
    ),
  }
}

export function marketShareCard(
  locale: Locale,
  days: MarketDay[],
  period: Period,
  focus: ShareFocus = {},
): ShareDraft | undefined {
  const day = focus.day
  const chart = marketShareChart(locale, days, getMarketAuthorOrder(days), day)
  const top = chart && leadingSeries(chart)
  if (!chart || !top) return undefined
  const served = { lab: top.label, share: top.value, when: shareWhen(locale, chart, period) }
  return {
    id: "market-share",
    locale,
    title: shareTitle(locale, "market-share"),
    range: day === undefined ? shareRange(locale, chart, period) : shareDate(locale, chart, period),
    highlight: top.label,
    headline: translate(locale, "share.market.headline", served),
    stat: { value: top.value, label: translate(locale, "share.market.stat", served) },
    chart,
    view: { period, leaderboard: "weekly" },
    variant: (next) => marketShareCard(locale, days, period, { day: next.day }),
  }
}

export function geoCard(locale: Locale, countries: CountryEntry[]): ShareDraft | undefined {
  const top = countries[0]
  if (!top) return undefined
  const max = Math.max(0, ...countries.map((country) => country.tokens)) || 1
  const name = (country: string) => formatCountryName(country, tag(locale), translate(locale, "home.unknown"))
  const sent = { country: name(top.country), share: formatGeoShare(top.share) }
  return {
    id: "geo-breakdown",
    locale,
    title: shareTitle(locale, "geo-breakdown"),
    range: translate(locale, "share.range.past2Months"),
    highlight: sent.country,
    headline: translate(locale, "share.geo.headline", sent),
    stat: { value: sent.share, label: translate(locale, "share.geo.stat", sent) },
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
  "#ff6467",
  "#fb64b6",
]
export const otherUsageColor = "#ff8904"

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

// Tokens over a whole range, in trillions: past a thousand with separators rather than a rarely seen Q.
export function formatTotalTokens(value: number) {
  return value >= 1000 ? `${new Intl.NumberFormat("en").format(Math.round(value))}T` : formatTokens(value)
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

export function usageShareChart(
  locale: Locale,
  data: UsagePoint[],
  format: (value: number) => string,
  total: string,
  day?: number,
) {
  const points = data.length > 1 ? data.slice(0, -1) : data
  const order = getTopModelsSegmentOrder(points)
  const keys = [...order.keys()].filter((key) => key !== "Other").slice(0, shareSeriesLimit)
  return stackedShareChart(
    locale,
    points.map((point) => ({
      label: shareDay(locale, point.start),
      start: point.start,
      values: new Map(point.segments.map((segment) => [segment.model, segment.value])),
    })),
    keys.map((key) => ({ key, label: key, color: getRankColor(key, 0, order, usageColors) })),
    format,
    false,
    total,
    day,
  )
}

export function marketShareChart(locale: Locale, data: MarketDay[], order: Map<string, number>, day?: number) {
  const days = data.length > 1 ? data.slice(0, -1) : data
  const keys = [...order.keys()].filter((key) => key !== "Other").slice(0, shareSeriesLimit)
  return stackedShareChart(
    locale,
    days.map((day) => ({
      label: shareDay(locale, day.start),
      start: day.start,
      values: new Map(day.authors.map((author) => [author.author, author.share])),
    })),
    keys.map((key) => ({
      key,
      label: formatCatalogLabName(key),
      color: getRankColor(key, 0, order, marketColors),
    })),
    (value) => `${value.toFixed(1)}%`,
    true,
    translate(locale, "share.total.allLabs"),
    day,
  )
}

export function stackedShareChart(
  locale: Locale,
  columns: { label: string; start?: string; values: Map<string, number> }[],
  named: Omit<ShareSeries, "value">[],
  format: (value: number) => string,
  normalized: boolean,
  total: string,
  day?: number,
): Extract<ShareChart, { kind: "stacked" }> | undefined {
  if (columns.length === 0 || named.length === 0) return undefined
  const keys = new Set(named.map((item) => item.key))
  const rows = columns.map((column) => {
    const values = named.map((item) => column.values.get(item.key) ?? 0)
    const other = [...column.values].reduce((sum, [key, value]) => (keys.has(key) ? sum : sum + value), 0)
    return { label: column.label, start: column.start, values: [...values, other] }
  })
  if (day !== undefined && !rows[day]) return undefined
  // The column the legend and total are for: the chosen day, or the latest.
  const at = rows[day ?? rows.length - 1]
  const last = at?.values ?? []
  return {
    kind: "stacked",
    normalized,
    columns: rows,
    day,
    // That column's whole: its sum, or 100% when the columns are shares.
    total: {
      label: translate(locale, "share.total.date", { label: total, date: at?.label ?? "" }),
      value: normalized ? "100%" : format(last.reduce((sum, value) => sum + value, 0)),
    },
    series: [...named, { key: "other", label: translate(locale, "share.other"), color: shareOtherColor }]
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

// The named series with the most in the card's column: the chosen day, or the latest.
export function leadingSeries(chart: Extract<ShareChart, { kind: "stacked" }>) {
  const last = chart.columns.at(chart.day ?? -1)?.values ?? []
  return chart.series
    .map((item, index) => ({ item, value: last[index] ?? 0 }))
    .filter((entry) => entry.item.key !== "other")
    .toSorted((a, b) => b.value - a.value)[0]?.item
}

export function shareRange(locale: Locale, chart: Extract<ShareChart, { kind: "stacked" }>, period: Period) {
  return translate(locale, period === "weekly" ? "share.range.pastWeeks" : "share.range.pastDays", {
    count: chart.columns.length,
  })
}

export function shareWhen(locale: Locale, chart: Extract<ShareChart, { kind: "stacked" }>, period: Period) {
  const date = chart.columns.at(chart.day ?? -1)?.label ?? ""
  return translate(locale, period === "weekly" ? "share.when.week" : "share.when.day", { date })
}

// The eyebrow of a card about one column: its date.
export function shareDate(locale: Locale, chart: Extract<ShareChart, { kind: "stacked" }>, period: Period) {
  const date = chart.columns.at(chart.day ?? -1)?.label ?? ""
  return period === "weekly" ? translate(locale, "share.range.weekOf", { date }) : date
}

// A column's first day (YYYY-MM-DD) as its axis label, as in Nov 23.
function shareDay(locale: Locale, start: string) {
  return new Intl.DateTimeFormat(tag(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(
    Date.parse(`${start}T00:00:00Z`),
  )
}
