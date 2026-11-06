import { config } from "~/config"
import { query } from "@solidjs/router"
import { githubSnapshot, type GithubRelease } from "~/lib/github-snapshot"
import { staleValue } from "~/lib/edge-cache"
import {
  changelogEntryView,
  changelogView,
  entryStatus,
  parseReleaseNotes,
  type ChangelogView,
  type ReleaseNotes,
} from "~/lib/changelog-notes"

type Release = GithubRelease

// Loaded on first use, on the server: github-api uses node:fs in dev, which must not be part of the
// browser's bundle, and pages import this module for its types and queries.
const githubApi = () => import("~/lib/github-api")

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

// The releases are reused for 15 minutes, which keeps the site well inside GitHub's unauthenticated
// rate limit (the Worker has no token), and refreshed in the background (lib/edge-cache.ts), with
// GitHub's response also kept at the edge for 15 minutes. A page render waits at most 300 ms for
// GitHub; without any good value yet (a new isolate at a new location, or GitHub failing) the
// newest releases from the build-time snapshot stand in (marked stale), and with none of that the
// changelog is empty and not ok. Dev also keeps the last good releases on disk (githubDevCache).
const releases = staleValue<ChangelogRelease[]>({
  key: "github/releases",
  freshFor: 15 * 60_000,
  wait: 300,
  load: async () => {
    const releases = await fetchReleases()
    const { githubDevCache } = await githubApi()
    if (releases) await githubDevCache.write("changelog", releases)
    return releases
  },
  fallback: async () =>
    (await (await githubApi()).githubDevCache.read<ChangelogRelease[]>("changelog")) ??
    toReleases((await githubSnapshot()).releases ?? []),
})

/**
 * The newest releases, up to 300 (three pages of GitHub's API). Empty (and not ok) only when GitHub
 * fails, nothing loaded before and there is no build-time snapshot. Pages use the default wait;
 * feeds and JSON pass `feedWait`, a little longer, and answer from the snapshot (marked stale, so
 * they are cached briefly) while a background refresh fetches the rest.
 */
/** How long feeds, JSON and the sitemap wait for GitHub before answering from the stale value or snapshot. */
export const feedWait = 500

export async function loadChangelog(wait?: number): Promise<ChangelogData> {
  const result = await releases(wait)
  if (!result.value?.length) return { ok: false, releases: [] }
  return { ok: true, stale: result.standIn || undefined, releases: result.value }
}

/**
 * Pages of 100 until one comes back short, one fails, or three have loaded. A failed page stops
 * there and keeps the pages before it; a failed first page fails the fetch, so older pages never
 * stand in for the newest releases.
 */
async function fetchReleases(): Promise<ChangelogRelease[] | undefined> {
  const result = await [1, 2, 3].reduce<Promise<{ pages: Release[][]; done: boolean }>>(
    async (previous, page) => {
      const state = await previous
      if (state.done) return state
      const next = await fetchReleasePage(page)
      if (!next) return { pages: state.pages, done: true }
      return { pages: [...state.pages, next], done: next.length < 100 }
    },
    Promise.resolve({ pages: [], done: false }),
  )
  if (result.pages.length === 0) return
  return toReleases(result.pages.flat())
}

// Drafts have no publish date yet. GitHub lists releases by when their tag was created, so they are
// sorted by when they were published, newest first. Only app releases (`v…` tags) count, for every
// reader (pages, feeds and JSON): package releases such as `process-daemon v0.5.0` share the list.
function toReleases(releases: Release[]): ChangelogRelease[] {
  return releases
    .flatMap((release) => {
      if (!release.published_at || !/^v\d/.test(release.tag_name)) return []
      const parsed = parseMarkdown(release.body || "")
      return {
        tag: release.tag_name,
        name: release.name,
        date: release.published_at,
        url: release.html_url,
        highlights: parsed.highlights,
        sections: parsed.sections,
        notes: parseReleaseNotes(release.body || ""),
      }
    })
    .toSorted((a, b) => b.date.localeCompare(a.date))
}

async function fetchReleasePage(page: number): Promise<Release[] | undefined> {
  const { githubFetch } = await githubApi()
  const response = await githubFetch(
    `https://api.github.com/repos/anomalyco/opencode/releases?per_page=100&page=${page}`,
    {
      cf: {
        // best-effort edge caching (ignored outside Cloudflare)
        cacheTtl: 60 * 15,
        cacheEverything: true,
      },
    } as RequestInit,
  )

  if (!response?.ok) return

  const data = await response.json().catch(() => undefined)
  if (!Array.isArray(data)) return

  return data as Release[]
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

/**
 * `/changelog/<tag>.json`: one entry as JSON, for the apps' "What's new" (a stable URL per version)
 * and anything else that wants one release.
 */
export async function changelogEntryJson(tag: string) {
  const result = await loadChangelog(feedWait).catch((): ChangelogData => ({ ok: false, releases: [] }))
  const view = changelogEntryView(result.releases, tag, result.stale)
  const entry = view.entries[0]
  const status = entryStatus(view)
  return new Response(
    JSON.stringify(
      entry
        ? { entry, url: `${config.baseUrl}/changelog/${entry.releases[0].tag}`, newer: view.newer, older: view.older }
        : { error: status === 404 ? "Unknown release" : "Changelog unavailable" },
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          status === 503
            ? "no-store"
            : entry && !result.stale
              ? "public, max-age=60, s-maxage=300, stale-while-revalidate=86400"
              : "public, max-age=1, s-maxage=60",
        ...(status === 503 ? { "Retry-After": "60" } : {}),
        "Access-Control-Allow-Origin": "*",
      },
    },
  )
}

function parseHighlights(body: string): HighlightGroup[] {
  const groups = new Map<string, HighlightItem[]>()
  const regex = /<highlight\s+source="([^"]+)">([\s\S]*?)<\/highlight>/g
  let match

  while ((match = regex.exec(body)) !== null) {
    const source = match[1]
    const content = match[2]

    const titleMatch = content.match(/<h2>([^<]+)<\/h2>/)
    const pMatch = content.match(/<p(?:\s+short="([^"]*)")?>([^<]+)<\/p>/)
    const imgMatch = content.match(/<img\s+width="([^"]+)"\s+height="([^"]+)"\s+alt="[^"]*"\s+src="([^"]+)"/)
    const videoMatch = content.match(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+)\s*$/m)

    const media = (() => {
      if (videoMatch) return { type: "video", src: videoMatch[1] } satisfies HighlightMedia
      if (imgMatch) {
        return {
          type: "image",
          src: imgMatch[3],
          width: imgMatch[1],
          height: imgMatch[2],
        } satisfies HighlightMedia
      }
    })()

    if (!titleMatch || !media) continue

    const item: HighlightItem = {
      title: titleMatch[1],
      description: pMatch?.[2] || "",
      shortDescription: pMatch?.[1],
      media,
    }

    if (!groups.has(source)) groups.set(source, [])
    groups.get(source)!.push(item)
  }

  return Array.from(groups.entries()).map(([source, items]) => ({ source, items }))
}

function parseMarkdown(body: string) {
  const lines = body.split("\n")
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  let skip = false

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current)
      current = { title: line.slice(3).trim(), items: [] }
      skip = false
      continue
    }

    if (line.startsWith("**Thank you")) {
      skip = true
      continue
    }

    if (line.startsWith("- ") && !skip) current?.items.push(line.slice(2).trim())
  }

  if (current) sections.push(current)
  return { sections, highlights: parseHighlights(body) }
}
