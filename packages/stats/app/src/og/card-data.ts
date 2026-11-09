import { statModel } from "@opencode/stats-core/domain/model-normalization"
import { formatTokens, fromFirstUsage, isoDay } from "../lib/format"
import { baseUrl } from "../lib/language"
import { publicModelName } from "../lib/model-name"
import { hasProviderIcon, providerIconId } from "../lib/provider-icon"
import { formatCatalogLabName, isKnownCatalogLab } from "../routes/model-catalog"
import type { OgCard } from "./card"

// Bump to change every card's URL, so unfurlers fetch the new image after a design change.
const cardVersion = "1"

type Usage = { date: string; tokens: number }

// The parts of ModelPageData and LabPageData (src/lib/page-data.ts) a card shows.
type ModelCardData = {
  path: string
  catalog: { entry: { name: string; lab: string } | null; labs: { id: string }[] }
  stats: {
    model: string
    provider: string
    rank: number | null
    totals: { tokens: number }
    usage: Usage[]
    updatedAt: string | null
  } | null
}
type LabCardData = {
  lab: { id: string; name: string; models: unknown[] } | null
  stats: { totals: { tokens: number }; usage: Usage[]; updatedAt: string | null } | null
}

// The card for a model page, or undefined when the page is a 404.
export function modelOgCard(data: ModelCardData): OgCard | undefined {
  const entry = data.catalog.entry
  const stats = data.stats
  const name = entry?.name ?? (stats ? publicModelName(statModel(stats.model, undefined)) : undefined)
  if (!name) return undefined
  const lab = entry?.lab ?? stats?.provider
  const known = isKnownCatalogLab(
    lab,
    data.catalog.labs.map((item) => item.id),
  )
  return {
    kind: "model",
    path: data.path,
    name,
    lab: lab && known ? { name: formatCatalogLabName(lab), icon: icon(lab) } : null,
    rank: stats?.rank ?? null,
    tokens: stats?.totals.tokens ?? 0,
    days: days(stats),
    updatedAt: stats?.updatedAt ?? null,
  }
}

// The card for a lab page, or undefined when the page is a 404.
export function labOgCard(data: LabCardData): OgCard | undefined {
  const lab = data.lab
  if (!lab) return undefined
  return {
    kind: "lab",
    path: `/data/${lab.id}`,
    name: lab.name,
    icon: icon(lab.id),
    tokens: data.stats?.totals.tokens ?? 0,
    models: lab.models.length,
    days: days(data.stats),
    updatedAt: data.stats?.updatedAt ?? null,
  }
}

// The image is English in every locale, so every page links the same URL. ?v= changes when anything the card shows
// changes, and once a UTC day, so unfurlers that cache images by URL pick up new numbers.
export function ogImageUrl(card: OgCard) {
  return `${baseUrl}${card.path}/og.png?v=${ogVersion(card)}`
}

export function ogVersion(card: OgCard) {
  const shown =
    card.kind === "model"
      ? [card.lab?.name, card.lab?.icon, card.rank, formatTokens(card.tokens)]
      : [card.icon, formatTokens(card.tokens), card.models]
  return fnv1a(JSON.stringify([cardVersion, card.kind, card.path, card.name, ...shown, card.updatedAt?.slice(0, 10)]))
}

export function ogImageAlt(card: OgCard) {
  const tokens = `${formatTokens(card.tokens)} tokens in the last 2 months`
  if (card.kind === "lab") {
    const models = `${card.models} ${card.models === 1 ? "model" : "models"}`
    if (card.tokens === 0) return `${card.name} on OpenCode Data, with ${models}.`
    return `${card.name} on OpenCode Data, with ${tokens} across ${models}.`
  }
  const subject = card.lab ? `${card.name} by ${card.lab.name} on OpenCode Data` : `${card.name} on OpenCode Data`
  if (card.tokens === 0) return `${subject}.`
  if (!card.rank) return `${subject}, with ${tokens}.`
  return `${subject}, ranked #${card.rank} last week with ${tokens}.`
}

function icon(lab: string) {
  return hasProviderIcon(lab) ? providerIconId(lab) : null
}

function days(stats: { usage: Usage[]; updatedAt: string | null } | null) {
  if (!stats) return []
  return fromFirstUsage(stats.usage).map((point) => ({
    date: isoDay(point.date, stats.updatedAt),
    tokens: point.tokens,
  }))
}

function fnv1a(value: string) {
  const hash = Array.from(value).reduce(
    (state, char) => Math.imul(state ^ char.charCodeAt(0), 0x01000193) >>> 0,
    0x811c9dc5,
  )
  return hash.toString(16).padStart(8, "0")
}
