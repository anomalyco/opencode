export * as Token from "./token"

// C4: bytes-per-token densities measured on real corpora (fork plan §C4).
// Dense structured text tokenizes far below the ~4 chars/token prose rule:
// chars ÷ 4 is 2.7–2.8x optimistic on CSV and 1.8x on logs. Chars ≈ bytes
// stays the working assumption throughout.
const DENSITY: Record<string, number> = {
  csv: 1.3,
  tsv: 1.3,
  json: 1.5,
  ndjson: 1.5,
  jsonl: 1.5,
  log: 2,
}

const DEFAULT_DENSITY = 4

// Resolves a bytes-per-token density from a hint that is either a format tag
// ("csv") or a filename ("data.csv"); unknown or missing hints fall back to
// the prose default so general estimates keep today's behavior.
const density = (hint?: string) => {
  if (!hint) return DEFAULT_DENSITY
  const dot = hint.lastIndexOf(".")
  const tag = dot === -1 ? hint : hint.slice(dot + 1)
  return DENSITY[tag.toLowerCase()] ?? DEFAULT_DENSITY
}

export const estimate = (input: string, hint?: string) => {
  return Math.max(0, Math.round(input.length / density(hint)))
}
