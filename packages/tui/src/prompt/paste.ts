import { PasteSummaryDefaults, type PasteSummary } from "../config"

// The placeholder a paste is replaced by, or undefined when it goes into the prompt as typed.
export function pasteSummary(content: string, config: PasteSummary | undefined) {
  const settings = { ...PasteSummaryDefaults, ...config }
  const lines = (content.match(/\n/g)?.length ?? 0) + 1
  if (lines < settings.lines && content.length <= settings.characters) return
  const values: Record<string, () => string> = {
    lines: () => String(lines),
    characters: () => String(content.length),
    bytes: () => String(Buffer.byteLength(content)),
    excerpt: () => excerpt(content, settings.excerpt),
  }
  // The placeholder is one line of the prompt: a line break in it would split the extmark.
  return settings.format
    .replace(/\{(lines|characters|bytes|excerpt)\}/g, (_, token: string) => values[token]())
    .replace(/\s*\n\s*/g, " ")
}

function excerpt(content: string, length: number) {
  const flat = content.replace(/\s+/g, " ").trim()
  const chars = Array.from(flat)
  if (chars.length <= length) return flat
  return chars.slice(0, length).join("").trimEnd() + "…"
}
