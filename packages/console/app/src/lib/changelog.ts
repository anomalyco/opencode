import { query } from "@solidjs/router"
import {
  parseReleaseBody,
  type ChangelogData,
  type ChangelogRelease,
  type HighlightGroup,
} from "./changelog-feed"

export { parseReleaseBody }
export type { ChangelogData, ChangelogRelease, HighlightGroup, HighlightItem } from "./changelog-feed"

type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
}

export async function loadChangelog(): Promise<ChangelogData> {
  const response = await fetch("https://api.github.com/repos/anomalyco/opencode/releases?per_page=20", {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "OpenCode-Console",
    },
    cf: {
      // best-effort edge caching (ignored outside Cloudflare)
      cacheTtl: 60 * 5,
      cacheEverything: true,
    },
  } as RequestInit).catch(() => undefined)

  if (!response?.ok) return { ok: false, releases: [] }

  const data = await response.json().catch(() => undefined)
  if (!Array.isArray(data)) return { ok: false, releases: [] }

  const releases = (data as Release[]).map((release): ChangelogRelease => {
    const parsed = parseReleaseBody(release.body || "")
    return {
      tag: release.tag_name,
      name: release.name,
      date: release.published_at,
      url: release.html_url,
      highlights: parsed.highlights,
      sections: parsed.sections,
    }
  })

  return { ok: true, releases }
}

export const changelog = query(async () => {
  "use server"
  const result = await loadChangelog()
  return result.releases
}, "changelog")
