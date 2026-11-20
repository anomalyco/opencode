import { Schema } from "effect"

/** A page the browser showed, newest first in the window's list of the last pages. */
export const Visit = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  /** Artifact addresses resolve only in the session in which the user opened them. */
  session: Schema.optionalKey(Schema.String),
  /** The page's icon as a data URL, when it was small enough to keep. */
  icon: Schema.optionalKey(Schema.String),
})

export type Visit = typeof Visit.Type

export const History = Schema.Struct({ visits: Schema.Array(Visit) })

export type History = typeof History.Type

/**
 * Visits the window's list keeps; the new tab page shows the first few, and their icons draw in the address field's
 * suggestions. The history itself, with every page and the pages imported from other browsers, is main's (`store.ts`).
 */
const MAX_VISITS = 30

/** Icons larger than this stay out of the stored history; a 32px PNG is a few kilobytes. */
const MAX_STORED_ICON = 6_000

/** The pages the history records: web pages and workspace files, not blank or internal ones. */
export function recordable(url: string) {
  return /^(?:https?|file|workspace|artifact):\/\//i.test(url)
}

/**
 * Puts a visit first, replacing an earlier visit of the same URL, and drops the oldest past the limit. A visit without
 * a title or icon yet keeps the earlier visit's.
 */
export function remember(visits: readonly Visit[], visit: Visit, icon?: string): Visit[] {
  const earlier = visits.find((item) => item.url === visit.url && item.session === visit.session)
  const kept = storable(icon) ?? earlier?.icon
  const title = visit.title || earlier?.title || ""

  const next: Visit = kept ? { ...visit, title, icon: kept } : { ...visit, title }

  // Copies, so a store that reconciles the new list in place never sees its own records at moved positions.
  return [next, ...visits.flatMap((item) => (item.url === visit.url && item.session === visit.session ? [] : [{ ...item }]))].slice(0, MAX_VISITS)
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
