import { Schema } from "effect"

/** A browser tab's page as the desktop last reported it. */
const SavedTab = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  /** The page's title, when it had one. */
  title: Schema.optionalKey(Schema.String),
  /** The page's icon as a data URL, when it was small enough to keep. */
  icon: Schema.optionalKey(Schema.String),
})

export type SavedTab = typeof SavedTab.Type

/** One saved tab while it is built; its title and icon are written only when known. */
type Draft = { -readonly [Key in keyof SavedTab]: SavedTab[Key] }

/**
 * Each session's browser tabs as the desktop last reported them, the session saved last first. When the app opens, the
 * side strip draws its stored tabs from this, and holds each label and icon until the tab's page has its own again.
 */
export const SavedTabs = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ session: Schema.String, tabs: Schema.Array(SavedTab) })),
})

export type SavedTabs = typeof SavedTabs.Type

/** Sessions kept. The strip of an older one draws its browser tabs once the desktop reports them, as before. */
const MAX_SESSIONS = 50

/** Icons larger than this stay out of the saved tabs, as out of the history; a 32px PNG is a few kilobytes. */
const MAX_SAVED_ICON = 6_000

/** A tab as the desktop reports it, or as it was saved while the desktop has not reported it. */
type Reported = { readonly url: string; readonly title?: string; readonly loading?: boolean }

export function savedTab(saved: SavedTabs, session: string, id: string) {
  return saved.sessions.find((item) => item.session === session)?.tabs.find((tab) => tab.id === id)
}

/**
 * The title a tab's strip label draws: the page's own, else the saved one. A tab the desktop restored reports no title
 * until its document names itself, at the saved address or, while it loads, at the one that address redirected to.
 */
export function tabTitle(tab: Reported, saved: SavedTab | undefined) {
  return tab.title || (saved && (saved.url === tab.url || tab.loading) ? saved.title : undefined)
}

/**
 * The icon a tab's strip label draws: the page's own, else the saved one while the tab stays on the saved address's
 * site, as the desktop keeps a page's icon. A page reports its icon only once it has loaded it, and a restored tab's
 * page reports none before.
 */
export function tabIcon(tab: Reported, icon: string | undefined, saved: SavedTab | undefined) {
  return icon ?? (saved && site(saved.url) === site(tab.url) ? saved.icon : undefined)
}

/**
 * The saved tabs with a session's replaced by its inventory, or undefined when that changes nothing. A tab keeps its
 * saved icon while it stays at its address. A session with no tabs is dropped, and so is the oldest one past the limit.
 */
export function saveTabs(
  saved: SavedTabs,
  session: string,
  tabs: readonly (Reported & { readonly id: string })[],
): SavedTabs | undefined {
  const earlier = saved.sessions.find((item) => item.session === session)?.tabs ?? []

  const next = tabs.map((tab) => {
    const before = earlier.find((item) => item.id === tab.id)
    const entry: Draft = { id: tab.id, url: tab.url }
    const title = tabTitle(tab, before)
    const icon = tabIcon(tab, undefined, before)

    if (title) entry.title = title

    if (icon) entry.icon = icon

    return entry
  })

  if (same(earlier, next)) return

  return {
    sessions: [...(next.length ? [{ session, tabs: next }] : []), ...others(saved, session)].slice(0, MAX_SESSIONS),
  }
}

/**
 * The saved tabs with the icon a tab's page just reported, or undefined when that changes nothing: the tab is not
 * saved, has this icon, or the icon is too large to keep. The page's inventory comes first, so the icon lands on the
 * address it belongs to.
 */
export function saveIcon(saved: SavedTabs, session: string, id: string, icon: string): SavedTabs | undefined {
  const tab = savedTab(saved, session, id)

  if (!tab || tab.icon === icon || icon.length > MAX_SAVED_ICON) return

  return {
    sessions: saved.sessions.map((item) => ({
      session: item.session,
      tabs: item.tabs.map((entry) => (item.session === session && entry.id === id ? { ...entry, icon } : { ...entry })),
    })),
  }
}

/** The saved tabs without a session's, or undefined when it has none. */
export function forgetTabs(saved: SavedTabs, session: string): SavedTabs | undefined {
  if (saved.sessions.some((item) => item.session === session)) return { sessions: others(saved, session) }
}

// A web address's origin; a file or any other address is its own site.
function site(url: string) {
  const origin = URL.canParse(url) ? new URL(url).origin : "null"

  return origin === "null" ? url : origin
}

// Copies, so a store that reconciles the new list in place never sees its own records at moved positions.
function others(saved: SavedTabs, session: string) {
  return saved.sessions.flatMap((item) =>
    item.session === session ? [] : [{ session: item.session, tabs: item.tabs.map((tab) => ({ ...tab })) }],
  )
}

function same(earlier: readonly SavedTab[], next: readonly SavedTab[]) {
  return (
    earlier.length === next.length &&
    earlier.every((tab, index) => {
      const other = next[index]

      return tab.id === other?.id && tab.url === other.url && tab.title === other.title && tab.icon === other.icon
    })
  )
}
