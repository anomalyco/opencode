// Embeds: a section's share card on someone else's page, in an iframe of /data/embed/<section> (routes/embed). The
// URL carries the card's options. A live embed rebuilds the card from the latest data each time it loads; a fixed one
// carries its card in the URL's fragment, compressed, so it keeps the numbers it was made with. The fragment never
// reaches the server, so its length doesn't matter there.
import { defaultShareOptions, shareSizes, type ShareCard, type ShareOptions } from "./card"
import type { Period } from "../component/period-toggle"

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

const layouts = ["headline", "number", "chart"] as const
const themes = ["dark", "light", "leader"] as const
const periods = ["weekly", "daily"] as const

// The widest each size sits on a host page by default; the iframe shrinks with narrower columns.
const widths: Record<ShareOptions["size"], number> = { "4:5": 540, "1:1": 540, "9:16": 405, "16:9": 960 }

export function embedUrl(base: string, card: ShareCard & { view?: ShareView }, options: ShareOptions) {
  const url = new URL(`embed/${card.id}`, base)
  url.searchParams.set("layout", options.layout)
  url.searchParams.set("size", options.size)
  url.searchParams.set("style", options.theme)
  if (card.view) url.searchParams.set("period", card.view.period)
  if (card.view && card.id === "top-models") url.searchParams.set("leaderboard", card.view.leaderboard)
  return url
}

/** The iframe to paste: as wide as `widths` allows, as tall as its size's aspect ratio, and lazy-loaded. */
export function embedSnippet(url: string, title: string, size: ShareOptions["size"]) {
  const [width, height] = shareSizes[size]
  const style = `width:100%;max-width:${widths[size]}px;aspect-ratio:${width}/${height};border:0`
  return `<iframe src="${url}" title="OpenCode Data: ${title}" style="${style}" loading="lazy"></iframe>`
}

export function embedSize(size: ShareOptions["size"], maxWidth?: number) {
  const [width, height] = shareSizes[size]
  const shown = Math.min(widths[size], maxWidth ?? Infinity)
  return { width: shown, height: Math.round((shown * height) / width) }
}

/** The section, view and options an embed URL asks for, falling back to the defaults for anything it doesn't name. */
export function readEmbed(section: string, params: URLSearchParams) {
  const pick = <T extends string>(values: readonly T[], value: string | null, fallback: T) =>
    values.find((item) => item === value) ?? fallback
  const options: ShareOptions = {
    ...defaultShareOptions,
    layout: pick(layouts, params.get("layout"), defaultShareOptions.layout),
    size: pick(Object.keys(shareSizes) as ShareOptions["size"][], params.get("size"), defaultShareOptions.size),
    theme: pick(themes, params.get("style"), defaultShareOptions.theme),
  }
  const view: ShareView = {
    period: pick(periods, params.get("period"), "weekly"),
    leaderboard: pick(periods, params.get("leaderboard"), "weekly"),
  }
  return { section: shareSections.find((item) => item === section), options, view }
}

/** A card as a fixed embed's fragment: its JSON, deflated, in base64url. */
export async function packCard(card: ShareCard) {
  const stream = new Blob([JSON.stringify(card)]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export async function unpackCard(packed: string) {
  const binary = atob(packed.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return JSON.parse(await new Response(stream).text()) as ShareCard
}
