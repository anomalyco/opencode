import { Schema } from "effect"

/** A page the browser showed, newest first in the history. */
export const Visit = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  /** The page's icon as a data URL, when it was small enough to keep. */
  icon: Schema.optionalKey(Schema.String),
})

export type Visit = typeof Visit.Type

export const History = Schema.Struct({ visits: Schema.Array(Visit) })

export type History = typeof History.Type

/** Visits the history keeps; the new tab page shows the first few. */
const MAX_VISITS = 30

/** Icons larger than this stay out of the stored history; a 32px PNG is a few kilobytes. */
const MAX_STORED_ICON = 6_000

/** The pages the history records: web pages and workspace files, not blank or internal ones. */
export function recordable(url: string) {
  return /^(?:https?|file):\/\//i.test(url)
}

/**
 * Puts a visit first, replacing an earlier visit of the same URL, and drops the oldest past the limit. A visit without
 * a title or icon yet keeps the earlier visit's.
 */
export function remember(visits: readonly Visit[], visit: Pick<Visit, "url" | "title">, icon?: string): Visit[] {
  const earlier = visits.find((item) => item.url === visit.url)
  const kept = storable(icon) ?? earlier?.icon
  const title = visit.title || earlier?.title || ""

  const next: Visit = kept ? { url: visit.url, title, icon: kept } : { url: visit.url, title }

  // Copies, so a store that reconciles the new list in place never sees its own records at moved positions.
  return [next, ...visits.flatMap((item) => (item.url === visit.url ? [] : [{ ...item }]))].slice(0, MAX_VISITS)
}

/** The visits with a newly loaded icon on the visit of `url`, or undefined when nothing would change. */
export function withIcon(visits: readonly Visit[], url: string, icon: string) {
  const stored = storable(icon)

  if (!stored || !visits.some((visit) => visit.url === url && visit.icon !== stored)) return

  return visits.map((visit) => (visit.url === url ? { ...visit, icon: stored } : { ...visit }))
}

function storable(icon: string | undefined) {
  return icon && icon.length <= MAX_STORED_ICON ? icon : undefined
}

/**
 * Visits whose address or title contains the query, case-insensitively. Addresses that begin with the query come
 * first, as the address field completes them; within each group the newest visit leads.
 */
export function suggest(visits: readonly Visit[], query: string, limit: number) {
  const needle = query.trim().toLowerCase()

  if (!needle) return []

  const matches = visits.filter(
    (visit) => bare(visit.url).toLowerCase().includes(needle) || visit.title.toLowerCase().includes(needle),
  )

  return [
    ...matches.filter((visit) => completes(visit, needle)),
    ...matches.filter((visit) => !completes(visit, needle)),
  ].slice(0, limit)
}

/** Whether the visit's address begins with what the user typed, so Enter may open it in place of the typed text. */
export function completes(visit: Visit, query: string) {
  const needle = query.trim().toLowerCase()

  return !!needle && bare(visit.url).toLowerCase().startsWith(needle)
}

/** Splits text around case-insensitive matches of the query, for drawing the matched parts. */
export function highlight(text: string, query: string) {
  const needle = query.trim().toLowerCase()

  if (!needle) return [{ text, match: false }]
  const lower = text.toLowerCase()

  const starts = Array.from(lower.matchAll(new RegExp(escape(needle), "g")), (found) => found.index)
  const bounds = starts.flatMap((start) => [start, start + needle.length])

  return [0, ...bounds, text.length].flatMap((start, index, all) => {
    const end = all[index + 1]

    return end === undefined || end === start ? [] : [{ text: text.slice(start, end), match: index % 2 === 1 }]
  })
}

/** The address without its web scheme or a leading `www.`, as people type it. */
export function bare(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
