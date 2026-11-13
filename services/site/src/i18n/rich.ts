import type { Inline, RichText } from "~/lib/markdown"

/**
 * Turns copy with Markdown-style links into rich text: `[MCP servers](mcp)` becomes a link to
 * `links.mcp`. Translations keep each `(id)` and may move the links anywhere in the sentence.
 */
export function rich(text: string, links: Record<string, string | { href: string; external: true }>): RichText {
  return text.split(/(\[[^\]]+\]\(\w+\))/).flatMap((part): Inline[] => {
    const match = part.match(/^\[([^\]]+)\]\((\w+)\)$/)
    if (!match) return part ? [part] : []
    const link = links[match[2]]
    if (link === undefined) return [match[1]]
    if (typeof link === "string") return [{ text: match[1], href: link }]
    return [{ text: match[1], href: link.href, external: true }]
  })
}

/**
 * Splits copy into runs, with `[text](mark)` runs named: `"Download[ for {{os}}](os)"` gives
 * "Download" and " for macOS" marked `os`, which the page can hide or style. Translations keep each
 * `(mark)` and may move it anywhere in the string.
 */
export function marks(text: string): { text: string; mark?: string }[] {
  return text.split(/(\[[^\]]+\]\(\w+\))/).flatMap((part) => {
    const match = part.match(/^\[([^\]]+)\]\((\w+)\)$/)
    if (!match) return part ? [{ text: part }] : []
    return [{ text: match[1], mark: match[2] }]
  })
}

/** Joins sentences with a space, or with none after a full-width stop (Chinese and Japanese). */
export function joinSentences(parts: readonly string[]) {
  return parts.reduce((text, part) => (text === "" ? part : `${text}${sentenceGap(text)}${part}`), "")
}

/** The space between two sentences: none after a full-width stop such as 。 or ！. */
export function sentenceGap(text: string) {
  return /[。！？．」』）]$/.test(text.trim()) ? "" : " "
}
