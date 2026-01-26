type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
}

type Highlight = {
  source: string
  title: string
  description: string
  shortDescription?: string
  image?: {
    src: string
    width: string
    height: string
  }
  video?: string
}

function parseHighlights(body: string): Highlight[] {
  const highlights: Highlight[] = []
  const regex = /<highlight\s+source="([^"]+)">([\s\S]*?)<\/highlight>/g
  let match

  while ((match = regex.exec(body)) !== null) {
    const source = match[1]
    const content = match[2]

    const titleMatch = content.match(/<h2>([^<]+)<\/h2>/)
    const pMatch = content.match(/<p(?:\s+short="([^"]*)")?>([^<]+)<\/p>/)
    const imgMatch = content.match(/<img\s+width="([^"]+)"\s+height="([^"]+)"\s+alt="([^"]*)"\s+src="([^"]+)"/)
    // Match standalone GitHub asset URLs (videos)
    const videoMatch = content.match(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+)\s*$/m)

    if (titleMatch) {
      highlights.push({
        source,
        title: titleMatch[1],
        description: pMatch?.[2] || "",
        shortDescription: pMatch?.[1],
        image: imgMatch
          ? {
              width: imgMatch[1],
              height: imgMatch[2],
              src: imgMatch[4],
            }
          : undefined,
        video: videoMatch?.[1],
      })
    }
  }

  return highlights
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
  })

  if (!response.ok) {
    return { releases: [] }
  }

  const releases = (await response.json()) as Release[]

  return {
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
  }
}
