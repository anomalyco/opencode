import { Schema } from "effect"

/** A browser tab's page as the desktop last reported it. */
const SavedTab = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  /** The page's title, when it had one. */
  title: Schema.optionalKey(Schema.String),
})

export type SavedTab = typeof SavedTab.Type

/**
 * Each session's browser tabs as the desktop last reported them, the session saved last first. When the app opens, the
 * side strip draws its stored tabs from this, before the desktop attaches and reports them again.
 */
export const SavedTabs = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ session: Schema.String, tabs: Schema.Array(SavedTab) })),
})

export type SavedTabs = typeof SavedTabs.Type

/** Sessions kept. The strip of an older one draws its browser tabs once the desktop reports them, as before. */
const MAX_SESSIONS = 50

export function savedTab(saved: SavedTabs, session: string, id: string) {
  return saved.sessions.find((item) => item.session === session)?.tabs.find((tab) => tab.id === id)
}

/**
 * The title a tab's strip label draws: the page's own, else the one saved for the same address. A tab the desktop
 * restored reports no title until its page loads again.
 */
export function tabTitle(tab: { readonly url: string; readonly title?: string }, saved: SavedTab | undefined) {
  return tab.title || (saved?.url === tab.url ? saved.title : undefined)
}

/**
 * The saved tabs with a session's replaced by its inventory, or undefined when that changes nothing. A session with no
 * tabs is dropped, and so is the oldest one past the limit.
 */
export function saveTabs(
  saved: SavedTabs,
  session: string,
  tabs: readonly { readonly id: string; readonly url: string; readonly title: string }[],
): SavedTabs | undefined {
  const earlier = saved.sessions.find((item) => item.session === session)?.tabs ?? []

  const next = tabs.map((tab): SavedTab => {
    const title = tabTitle(
      tab,
      earlier.find((item) => item.id === tab.id),
    )

    return title ? { id: tab.id, url: tab.url, title } : { id: tab.id, url: tab.url }
  })

  if (same(earlier, next)) return

  return {
    sessions: [...(next.length ? [{ session, tabs: next }] : []), ...others(saved, session)].slice(0, MAX_SESSIONS),
  }
}

/** The saved tabs without a session's, or undefined when it has none. */
export function forgetTabs(saved: SavedTabs, session: string): SavedTabs | undefined {
  if (saved.sessions.some((item) => item.session === session)) return { sessions: others(saved, session) }
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

      return tab.id === other?.id && tab.url === other.url && tab.title === other.title
    })
  )
}
