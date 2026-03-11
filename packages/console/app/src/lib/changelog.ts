import { query } from "@solidjs/router"

type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
}

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
}

export type ChangelogData = {
  ok: boolean
  releases: ChangelogRelease[]
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

  const releases = (data as Release[]).map((release) => {
    const parsed = parseMarkdown(release.body || "")
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
