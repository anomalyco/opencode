import { translate } from "../i18n"
import { formatLongDate, formatPercent, formatPrice, formatTokens } from "./format"
import type { Locale } from "./language"
import type { HomePageData, LabPageData, ModelPageData } from "./page-data"

export function homeSummary(locale: Locale, data: HomePageData) {
  const [first, second, third] = data.leaderboard.weekly
  if (!data.updatedAt || !first || !second || !third) return undefined
  return translate(locale, "home.summary", {
    date: formatLongDate(locale, data.updatedAt),
    first: first.name,
    firstTokens: formatTokens(first.tokens * 1_000_000_000),
    second: second.name,
    secondTokens: formatTokens(second.tokens * 1_000_000_000),
    third: third.name,
    thirdTokens: formatTokens(third.tokens * 1_000_000_000),
  })
}

export function labSummary(locale: Locale, data: LabPageData) {
  const top = data.stats?.models[0]
  if (!data.lab || !data.stats || !top || data.stats.totals.tokens <= 0) return undefined
  return translate(locale, "lab.summary", {
    lab: data.lab.name,
    tokens: formatTokens(data.stats.totals.tokens),
    share: formatPercent(data.stats.tokenShare),
    model: data.lab.models.find((model) => model.slug === top.slug)?.name ?? top.model,
  })
}

export function modelSummary(locale: Locale, data: ModelPageData, name: string) {
  const cost = data.catalog.entry?.cost
  const sentences = [
    modelUsageSentence(locale, data, name),
    cost &&
      translate(locale, "model.summaryPrice", {
        model: name,
        input: formatPrice(cost.input),
        output: formatPrice(cost.output),
      }),
  ].filter((sentence): sentence is string => Boolean(sentence))
  return sentences.length > 0 ? sentences.join(" ") : undefined
}

function modelUsageSentence(locale: Locale, data: ModelPageData, name: string) {
  const stats = data.stats
  if (!stats || stats.totals.tokens <= 0) return undefined
  const share = formatPercent(stats.tokenShare)
  if (stats.rank === null) return translate(locale, "model.summaryUnranked", { model: name, share })
  return translate(locale, "model.summary", { model: name, rank: stats.rank, share })
}
