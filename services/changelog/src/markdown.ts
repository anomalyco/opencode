import { Marked, type Tokens } from "marked"

const REPO_URL = "https://github.com/anomalyco/opencode"

export type ChangelogEntry = {
  tag: string
  version: string
  date?: string
  anchor: string
  intro: string
  highlights: { title: string; body: string }[]
  sections: { title: string; body: string }[]
}

const ENTRY = /^## v\d/
const HEADING = /^## (v\S+)(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/
const SECTION = /^### (.+?)\s*$/
const HIGHLIGHT = /^\*\*(.+?)\*\*\s*:?\s*([\s\S]*)$/

/** Splits the root CHANGELOG.md into release entries, newest first as written. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: string[][] = []
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (ENTRY.test(line)) entries.push([line])
    else entries.at(-1)?.push(line)
  }
  return entries.map(([heading, ...body]) => parseEntry(heading, body))
}

function parseEntry(heading: string, body: string[]): ChangelogEntry {
  const match = HEADING.exec(heading)
  const tag = match?.[1] ?? heading.slice(3).trim().split(/\s+/)[0]
  const blocks: { title?: string; lines: string[] }[] = [{ lines: [] }]
  for (const line of body) {
    const section = SECTION.exec(line)
    if (section) blocks.push({ title: section[1], lines: [] })
    else blocks.at(-1)!.lines.push(line)
  }
  const [intro, ...rest] = blocks
  const highlights = rest.find((block) => block.title?.toLowerCase() === "highlights")

  return {
    tag,
    version: tag.slice(1),
    date: match?.[2],
    anchor: anchor(tag),
    intro: intro.lines.join("\n").trim(),
    highlights: highlights ? parseHighlights(highlights.lines) : [],
    sections: rest
      .filter((block) => block !== highlights)
      .map((block) => ({ title: block.title!, body: block.lines.join("\n").trim() })),
  }
}

function parseHighlights(lines: string[]) {
  const items: string[] = []
  for (const line of lines) {
    if (/^[-*] /.test(line)) items.push(line.slice(2))
    else if (items.length > 0 && line.trim()) items[items.length - 1] += `\n${line.trim()}`
  }
  return items.map((item) => {
    const match = HIGHLIGHT.exec(item.trim())
    if (!match) return { title: "", body: item.trim() }
    return { title: match[1].replace(/:$/, "").trim(), body: match[2].trim() }
  })
}

export function anchor(tag: string) {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function safeHref(href: string) {
  const value = href.trim()
  if (/^(https?:|mailto:)/i.test(value) || /^[/#]/.test(value)) return value
}

function external(href: string) {
  if (!/^https?:/i.test(href) || !URL.canParse(href)) return false
  return new URL(href).hostname !== "opencode.ai"
}

function anchorTag(href: string, label: string) {
  const target = external(href) ? ' target="_blank" rel="noopener noreferrer"' : ""
  return `<a href="${escape(href)}"${target}>${label}</a>`
}

const marked = new Marked({
  gfm: true,
  async: false,
  extensions: [
    {
      name: "reference",
      level: "inline",
      start: (src) => /(?<![\w&#/])#\d+\b/.exec(src)?.index,
      tokenizer: (src, tokens) => {
        // Marked calls start() on the text after its first character, hiding that character from the lookbehind.
        if (/[\w&#/]$/.test(tokens.at(-1)?.raw ?? "")) return
        const match = /^#(\d+)\b/.exec(src)
        if (match) return { type: "reference", raw: match[0], number: match[1] }
      },
      renderer: (token) => anchorTag(`${REPO_URL}/issues/${token.number}`, `#${token.number}`),
    },
  ],
  walkTokens: (token) => {
    if (token.type !== "link") return
    const link = token as Tokens.Link
    // A reference inside an existing link label would otherwise nest anchors.
    link.tokens = link.tokens.map((child) =>
      child.type === "reference" ? { type: "text", raw: child.raw, text: child.raw, escaped: false } : child,
    )
  },
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens)
      const url = safeHref(href)
      if (!url) return label
      const pull = new RegExp(`^${REPO_URL}/(?:pull|issues)/(\\d+)$`).exec(url)
      return anchorTag(url, pull && tokens.map((token) => token.raw).join("") === href ? `#${pull[1]}` : label)
    },
    image({ href, text }: Tokens.Image) {
      const url = safeHref(href)
      return url ? anchorTag(url, escape(text || url)) : escape(text)
    },
  },
})

/** Renders release-note Markdown to HTML with raw HTML escaped and only web or relative links kept. */
export function renderMarkdown(markdown: string) {
  return marked.parse(markdown) as string
}

export function renderInline(markdown: string) {
  return marked.parseInline(markdown) as string
}

export function renderEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    intro: renderMarkdown(entry.intro),
    highlights: entry.highlights.map((item) => ({ title: renderInline(item.title), body: renderInline(item.body) })),
    sections: entry.sections.map((section) => ({ title: section.title, body: renderMarkdown(section.body) })),
  }
}
