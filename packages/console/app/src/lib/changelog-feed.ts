export type HighlightMedia =
  | { type: "video"; src: string }
  | { type: "image"; src: string; width: string; height: string }

export type HighlightItem = {
  title: string
  description: string
  shortDescription?: string
  media?: HighlightMedia
}

export type HighlightGroup = {
  source: string
  items: HighlightItem[]
}

export type ChangelogSection = { title: string; items: string[] }

export type ChangelogRelease = {
  tag: string
  name: string
  date: string
  url: string
  highlights: HighlightGroup[]
  sections: ChangelogSection[]
}

export type ChangelogData = {
  ok: boolean
  releases: ChangelogRelease[]
}

/**
 * Parses one GitHub release body into the highlight groups and detail sections the feed carries. V2 notes open with a
 * `### Highlights` bullet list and group details under `### <Product>` sections; older notes use `<highlight
 * source="…">` HTML blocks and `## <Product>` sections. Both shapes are kept, as the feed still serves old releases.
 */
export function parseReleaseBody(body: string): { highlights: HighlightGroup[]; sections: ChangelogSection[] } {
  const htmlHighlights = parseHtmlHighlights(body)
  const { highlights, sections } = parseMarkdown(body)

  const groups = [...htmlHighlights]

  // V2 notes carry no <highlight> HTML: their `### Highlights` bullets are what the desktop app shows.
  if (htmlHighlights.length === 0) groups.push({ source: "Desktop", items: highlights })

  const hasDesktop = groups.some(
    (group) => group.source.toLowerCase().includes("desktop") && group.items.length > 0,
  )

  // Backfill from the Desktop section when nothing names Desktop, so a release whose Highlights bullets could not be
  // attributed to Desktop still shows its Desktop bullets in What's New.
  if (!hasDesktop) {
    const desktop = sections.find((section) => section.title.toLowerCase() === "desktop")

    if (desktop) groups.push({ source: "Desktop", items: desktop.items.flatMap(parseHighlightBullet) })
  }

  return { highlights: mergeGroups(groups), sections }
}


function mergeGroups(groups: HighlightGroup[]): HighlightGroup[] {
  const merged = new Map<string, HighlightItem[]>()

  for (const group of groups) {
    if (!group.items.length) continue

    const items = merged.get(group.source) ?? []
    items.push(...group.items)
    merged.set(group.source, items)
  }

  return Array.from(merged, ([source, items]) => ({ source, items: dedupeItems(items) }))
}

function dedupeItems(items: HighlightItem[]): HighlightItem[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key = `${item.title}\n${item.description}\n${item.media?.src ?? ""}`

    if (seen.has(key)) return false

    seen.add(key)

    return true
  })
}

function parseHtmlHighlights(body: string): HighlightGroup[] {
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

/**
 * Parses the Markdown portions of a release body. V2 notes use `### Highlights` and `### <Product>` headings; old
 * notes use `## <Product>` headings, so any heading from level two down starts a block.
 */
function parseMarkdown(body: string): { highlights: HighlightItem[]; sections: ChangelogSection[] } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  const blocks: { level: number; title: string; items: string[] }[] = []
  let current: (typeof blocks)[number] | undefined
  let skip = false

  for (const line of lines) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line)

    if (heading) {
      current = { level: heading[1].length, title: inlineText(heading[2]), items: [] }
      blocks.push(current)
      skip = false
      continue
    }

    if (line.startsWith("**Thank you")) {
      skip = true
      continue
    }

    if (/^[-*]\s+/.test(line) && !skip) current?.items.push(line.replace(/^[-*]\s+/, "").trim())
  }

  const highlights = blocks
    .filter((block) => block.level === 3 && block.title.toLowerCase() === "highlights")
    .flatMap((block) => block.items.flatMap(parseHighlightBullet))
  const sections = blocks
    .filter((block) => !(block.level === 3 && block.title.toLowerCase() === "highlights"))
    .map((block) => ({ title: block.title, items: block.items }))

  return { highlights, sections }
}

/** Reads one `### Highlights` bullet as `- **Title**: One or two sentences. ([#1](https://…))`. */
function parseHighlightBullet(item: string): HighlightItem[] {
  const match = /^\*\*(.+?)\*\*:?\s*([\s\S]*)$/.exec(item.trim())

  if (!match) return []

  const title = inlineText(match[1].replace(/:$/, ""))
  const description = stripTrailingReferences(inlineText(match[2]))

  if (!title || !description) return []

  return [{ title, description }]
}

/** Reduces inline Markdown to plain text, keeping the words behind links, images and emphasis. */
function inlineText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** Removes a trailing pull request reference such as `([#1](https://…), [#2](https://…))`. */
function stripTrailingReferences(value: string) {
  const reference = /(?:\[[^\]]*\]\([^)]*\)|<[^>]+>|#\d+)/

  return value.replace(
    new RegExp(`\\s*\\(\\s*${reference.source}(?:\\s*,\\s*${reference.source})*\\s*\\)\\s*$`),
    "",
  )
}
