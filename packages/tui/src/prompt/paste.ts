import { PasteSummaryDefaults, type PasteSummary } from "../config"

// The placeholder a paste is replaced by, or undefined when it goes into the prompt as typed.
export function pasteSummary(content: string, config: PasteSummary | undefined) {
  const settings = { ...PasteSummaryDefaults, ...config }
  if (lineCount(content) < settings.lines && content.length <= settings.characters) return
  return pasteLabel(content, config)
}

// The placeholder for this text, whatever its size: what an edited paste is relabelled with.
export function pasteLabel(content: string, config: PasteSummary | undefined) {
  const settings = { ...PasteSummaryDefaults, ...config }
  const lines = lineCount(content)
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

function lineCount(content: string) {
  return (content.match(/\n/g)?.length ?? 0) + 1
}

function excerpt(content: string, length: number) {
  const flat = content.replace(/\s+/g, " ").trim()
  const chars = Array.from(flat)
  if (chars.length <= length) return flat
  return chars.slice(0, length).join("").trimEnd() + "…"
}
