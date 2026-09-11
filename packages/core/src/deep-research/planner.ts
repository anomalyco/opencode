export * as Planner from "./planner"

const INTENT_TEMPLATES = [
  "",
  "technical analysis",
  "advisory",
  "patch",
  "exploit",
  "PoC",
  "affects",
  "vendor statement",
  "mitigation",
  "alternatives",
]

const IDENTIFIER_PATTERNS: Array<{ match: RegExp; normalize: (id: string) => string }> = [
  { match: /\bCVE-\d{4}-\d{4,7}\b/gi, normalize: (id) => id.toUpperCase() },
  { match: /\bCWE-\d{1,4}\b/gi, normalize: (id) => id.toUpperCase() },
  { match: /\bGHSA-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}\b/gi, normalize: (id) => id.toUpperCase() },
]

const QUOTED_PATTERN = /"([^"]{4,120})"/g

function extractIdentifiers(goal: string): string[] {
  const found = new Set<string>()
  for (const pattern of IDENTIFIER_PATTERNS) {
    for (const match of goal.matchAll(pattern.match)) found.add(pattern.normalize(match[0]))
  }
  return [...found]
}

function extractQuoted(goal: string): string[] {
  return [...goal.matchAll(QUOTED_PATTERN)].map((match) => match[1])
}

/**
 * Deterministic, LLM-free query expansion. Preferred over an in-tool LLM call:
 * the research tool must not silently depend on model availability or spend a
 * second model turn inside a single tool execution.
 */
export function planQueries(goal: string, maxQueries: number, depth: number): string[] {
  const base = goal.trim()
  if (!base) return []
  const identifiers = extractIdentifiers(base)
  const quoted = extractQuoted(base)
  const tokens = base
    .replace(/[^a-zA-Z0-9 _-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/\d{4,}/.test(token) && token.toLowerCase() !== "the")
  const noun = (tokens.slice(-2) || []).join(" ")

  const candidates = new Set<string>()
  const add = (query: string) => {
    const normalized = query.replace(/\s+/g, " ").trim()
    if (normalized && normalized.length >= 4 && !candidates.has(normalized.toLowerCase())) candidates.add(normalized)
  }

  if (identifiers.length > 0) {
    // Deep exploration of the specific identifier from every angle.
    for (const id of identifiers) {
      for (const intent of INTENT_TEMPLATES) add(intent ? `${id} ${intent}` : id)
      add(`${id} ${noun}`)
    }
  } else {
    for (const intent of INTENT_TEMPLATES.slice(0, 6)) add(intent ? `${base} ${intent}` : base)
  }
  if (quoted.length > 0) {
    for (const phrase of quoted) for (const intent of INTENT_TEMPLATES.slice(0, 4)) add(intent ? `${phrase} ${intent}` : phrase)
  }

  if (depth > 0 && tokens.length > 0) add(`${tokens.slice(0, 4).join(" ")} recent`)
  if (depth > 1 && tokens.length > 0) add(`${tokens.slice(0, 4).join(" ")} comparison`)

  return [...candidates].slice(0, Math.max(1, maxQueries))
}