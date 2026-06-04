// runtime/formatting.ts
// Pure functions for markdown → Telegram HTML / MarkdownV2 conversion.
// Uses placeholder extraction to protect code blocks, inline code, and
// links from regex transformations.

const RE_CODE_BLOCK = /```[\w]*\n?([\s\S]*?)```/g
const RE_INLINE_CODE = /`([^`]+)`/g
const RE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const RE_RAW_URL = /https?:\/\/[^\s<]+/g
const RE_HEADING = /^#{1,6}\s+(.+)$/gm
const RE_BLOCKQUOTE = /^>\s*(.*)$/gm
const RE_BOLD_STAR = /\*\*(.+?)\*\*/g
const RE_BOLD_UNDER = /__(.+?)__/g
const RE_ITALIC = /_([^_]+)_/g
const RE_STRIKE = /~~(.+?)~~/g
const RE_LIST_ITEM = /^[-*]\s+/gm

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeHTMLAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function extractCodeBlocks(text: string): { text: string; codes: string[] } {
  const codes: string[] = []
  let i = 0
  const result = text.replace(RE_CODE_BLOCK, (_, code: string) => {
    codes.push(code)
    return `\x00CB${i++}\x00`
  })
  return { text: result, codes }
}

function extractInlineCodes(text: string): { text: string; codes: string[] } {
  const codes: string[] = []
  let i = 0
  const result = text.replace(RE_INLINE_CODE, (_, code: string) => {
    codes.push(code)
    return `\x00IC${i++}\x00`
  })
  return { text: result, codes }
}

function extractLinks(text: string): { text: string; links: [string, string][] } {
  const links: [string, string][] = []
  let i = 0
  const result = text.replace(RE_LINK, (_, label: string, url: string) => {
    links.push([label, url])
    return `\x00LK${i++}\x00`
  })
  return { text: result, links }
}

function extractRawURLs(text: string): { text: string; urls: string[] } {
  const urls: string[] = []
  let i = 0
  const result = text.replace(RE_RAW_URL, (match: string) => {
    urls.push(match)
    return `\x00RU${i++}\x00`
  })
  return { text: result, urls }
}

export function markdownToTelegramHTML(text: string): string {
  if (!text) return ""

  const codeBlocks = extractCodeBlocks(text)
  text = codeBlocks.text

  const inlineCodes = extractInlineCodes(text)
  text = inlineCodes.text

  const links = extractLinks(text)
  text = links.text

  const rawURLs = extractRawURLs(text)
  text = rawURLs.text

  text = text.replace(RE_HEADING, "$1")
  text = text.replace(RE_BLOCKQUOTE, "$1")

  text = escapeHTML(text)

  text = text.replace(RE_BOLD_STAR, "<b>$1</b>")
  text = text.replace(RE_BOLD_UNDER, "<b>$1</b>")
  text = text.replace(RE_ITALIC, "<i>$1</i>")
  text = text.replace(RE_STRIKE, "<s>$1</s>")
  text = text.replace(RE_LIST_ITEM, "• ")

  for (let i = 0; i < links.links.length; i++) {
    const [label, url] = links.links[i]
    const safeLabel = escapeHTML(label)
    const safeUrl = escapeHTMLAttr(url)
    text = text.replace(`\x00LK${i}\x00`, `<a href="${safeUrl}">${safeLabel}</a>`)
  }

  for (let i = 0; i < rawURLs.urls.length; i++) {
    const raw = rawURLs.urls[i]
    const safeUrl = escapeHTMLAttr(raw)
    const safeLabel = escapeHTML(raw)
    text = text.replace(`\x00RU${i}\x00`, `<a href="${safeUrl}">${safeLabel}</a>`)
  }

  for (let i = 0; i < inlineCodes.codes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, `<code>${escapeHTML(inlineCodes.codes[i])}</code>`)
  }

  for (let i = 0; i < codeBlocks.codes.length; i++) {
    text = text.replace(
      `\x00CB${i}\x00`,
      `<pre><code>${escapeHTML(codeBlocks.codes[i])}</code></pre>`,
    )
  }

  return text
}

const MDV2_ESCAPE_RE = /([_*\[\]()~`>#+\-=|{}.!])/g

export function markdownToTelegramMarkdownV2(text: string): string {
  if (!text) return ""

  const codeBlocks = extractCodeBlocks(text)
  text = codeBlocks.text

  const inlineCodes = extractInlineCodes(text)
  text = inlineCodes.text

  const links = extractLinks(text)
  text = links.text

  text = text.replace(MDV2_ESCAPE_RE, "\\$1")

  for (let i = 0; i < links.links.length; i++) {
    const [label, url] = links.links[i]
    text = text.replace(`\x00LK${i}\x00`, `[${label}](${url})`)
  }

  for (let i = 0; i < inlineCodes.codes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, `\`${inlineCodes.codes[i]}\``)
  }

  for (let i = 0; i < codeBlocks.codes.length; i++) {
    text = text.replace(`\x00CB${i}\x00`, `\`\`\`\n${codeBlocks.codes[i]}\n\`\`\``)
  }

  return text
}

export function fitContent(
  content: string,
  formatFn: (s: string) => string,
  maxParsedLen: number,
): string {
  const trimmed = content.trim()
  if (!trimmed || maxParsedLen <= 0) return ""

  if (formatFn(trimmed).length <= maxParsedLen) return trimmed

  let low = 1
  let high = trimmed.length
  let best = trimmed.slice(0, 1)

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = trimmed.slice(0, mid)
    if (formatFn(candidate).length <= maxParsedLen) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

export * as Formatting from "./formatting"