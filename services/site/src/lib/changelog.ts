import { query } from "@solidjs/router"
import { changelogEntryView, changelogView, type ChangelogView, type ReleaseNotes } from "~/lib/changelog-notes"
import { loadChangelog } from "~/lib/changelog-releases"

// Types and queries for pages. Loading the releases is server-only (lib/changelog-releases.ts): the
// queries read it only inside their server functions, so it stays out of the browser's bundle.

export type HighlightMedia =
  | { type: "video"; src: string }
  | { type: "image"; src: string; width: string; height: string }

export type HighlightItem = {
  title: string
  description: string
  shortDescription?: string
  media: HighlightMedia
}

export type HighlightGroup = {
  source: string
  items: HighlightItem[]
}

export type ChangelogRelease = {
  tag: string
  name: string
  date: string
  url: string
  highlights: HighlightGroup[]
  sections: { title: string; items: string[] }[]
  notes: ReleaseNotes
}

export type ChangelogData = {
  ok: boolean
  /** Served from the last good response because GitHub failed just now. */
  stale?: boolean
  releases: ChangelogRelease[]
}

/** The latest 20 releases as they come from GitHub, for pages that read them directly (the press kit). */
export const changelog = query(async () => {
  "use server"
  const result = await loadChangelog()
  return result.releases.slice(0, 20)
}, "changelog")

/** One page of the changelog, filtered to the area keys in `filter`. */
export const changelogPage = query(async (page: number, filter: string[]): Promise<ChangelogView> => {
  "use server"
  const result = await loadChangelog()
  return changelogView(result.releases, { page, filter })
}, "changelog-page")

/** The entry for a release tag, with the entries before and after it. */
export const changelogEntry = query(async (tag: string): Promise<ChangelogView> => {
  "use server"
  const result = await loadChangelog()
  return changelogEntryView(result.releases, tag, result.stale)
}, "changelog-entry")

/** The newest few entries with notes in one product's areas, for its product page. */
export const productChangelog = query(async (filter: string[]): Promise<ChangelogView> => {
  "use server"
  const result = await loadChangelog()
  return changelogView(result.releases, { filter, size: 3 })
}, "product-changelog")
