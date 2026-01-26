type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
}

type HighlightMedia = { type: "video"; src: string } | { type: "image"; src: string; width: string; height: string }

type HighlightItem = {
  title: string
  description: string
  shortDescription?: string
  media: HighlightMedia
}

type HighlightGroup = {
  source: string
  items: HighlightItem[]
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const ok = "public, max-age=1, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400"
const error = "public, max-age=1, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400"

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

    let media: HighlightMedia | undefined
    if (videoMatch) {
      media = { type: "video", src: videoMatch[1] }
    } else if (imgMatch) {
      media = { type: "image", src: imgMatch[3], width: imgMatch[1], height: imgMatch[2] }
    }

    if (titleMatch && media) {
      const item: HighlightItem = {
        title: titleMatch[1],
        description: pMatch?.[2] || "",
        shortDescription: pMatch?.[1],
        media,
      }

      if (!groups.has(source)) {
        groups.set(source, [])
      }
      groups.get(source)!.push(item)
    }
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
      const title = line.slice(3).trim()
      current = { title, items: [] }
      skip = false
    } else if (line.startsWith("**Thank you")) {
      skip = true
    } else if (line.startsWith("- ") && !skip) {
      current?.items.push(line.slice(2).trim())
    }
  }
  if (current) sections.push(current)

  const highlights = parseHighlights(body)

  return { sections, highlights }
}

export async function GET() {
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
  } as any).catch((err) => {
    console.error("[changelog.json] fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  })

  const fail = () =>
    new Response(JSON.stringify({ releases: [] }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": error,
        ...cors,
      },
    })

  if (!response) return fail()
  if (!response.ok) {
    const body = await response.text().catch(() => undefined)
    console.error("[changelog.json] github non-ok", {
      status: response.status,
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset"),
      body: body?.slice(0, 300),
    })
    return fail()
  }

  const data = await response.json().catch((err) => {
    console.error("[changelog.json] json parse failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  })
  if (!Array.isArray(data)) {
    console.error("[changelog.json] invalid json", {
      type: typeof data,
    })
    return fail()
  }

  const releases = data as Release[]

  return new Response(
    JSON.stringify({
      releases: releases.map((release) => {
        const parsed = parseMarkdown(release.body || "")
        return {
          tag: release.tag_name,
          name: release.name,
          date: release.published_at,
          url: release.html_url,
          highlights: parsed.highlights,
          sections: parsed.sections,
        }
      }),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": ok,
        ...cors,
      },
    },
  )
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: cors,
  })
}
