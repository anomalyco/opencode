/** Retention evaluation (spec §7.5): scores how well the experimental run's
 * ledger (active records) and rendered context retain the expected facts
 * declared in bench/hidden. Matching is normalized token-Jaccard ≥ 0.4
 * record↔fact, normalized substring for the render text. */
import type { HiddenCase } from "./runner"

export interface RetentionArtifacts {
  records: Array<{ id: string; type: string; text: string }>
  invalidated: Array<{ id: string; type: string; text: string }>
  renderText: string | null
}

export interface ScoredFact {
  kind: string
  text: string
  retained: boolean
  via: "record" | "render" | null
}

export interface RetentionScore {
  precision: number | null
  recall: number | null
  f1: number | null
  scored: ScoredFact[]
  criticalOmissions: string[]
  wrongInvalidations: string[]
  unresolvedOpenItems: string[]
  falseClaims: string[]
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function tokenSet(s: string): Set<string> {
  return new Set(normalizeText(s).split(" ").filter(Boolean))
}

export function jaccard(a: string, b: string): number {
  const sa = tokenSet(a)
  const sb = tokenSet(b)
  if (sa.size === 0 && sb.size === 0) return 1
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

const MATCH_THRESHOLD = 0.4

function bestMatch<T extends { text: string }>(fact: string, items: T[]): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const item of items) {
    const score = jaccard(fact, item.text)
    if (score >= MATCH_THRESHOLD && score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

export function evaluateRetention(hidden: HiddenCase, artifacts: RetentionArtifacts): RetentionScore {
  const scored: ScoredFact[] = []
  const criticalOmissions: string[] = []
  const wrongInvalidations: string[] = []

  for (const fact of hidden.facts) {
    const active = bestMatch(fact.text, artifacts.records)
    if (active) {
      scored.push({ kind: fact.kind, text: fact.text, retained: true, via: "record" })
      continue
    }
    const onlyInvalidated = bestMatch(fact.text, artifacts.invalidated)
    if (onlyInvalidated) {
      scored.push({ kind: fact.kind, text: fact.text, retained: false, via: null })
      wrongInvalidations.push(fact.text)
      continue
    }
    const renderHit =
      artifacts.renderText !== null &&
      normalizeText(artifacts.renderText).includes(normalizeText(fact.text))
    if (renderHit) {
      scored.push({ kind: fact.kind, text: fact.text, retained: true, via: "render" })
      continue
    }
    scored.push({ kind: fact.kind, text: fact.text, retained: false, via: null })
    if (fact.kind === "user_correction" || fact.kind === "open_item") {
      criticalOmissions.push(fact.text)
    }
  }

  // An open item the active ledger no longer carries cannot ever be resolved.
  const unresolvedOpenItems = hidden.facts
    .filter((f) => f.kind === "open_item" && !bestMatch(f.text, artifacts.records))
    .map((f) => f.text)

  const retainedCount = scored.filter((f) => f.retained).length
  const recall = hidden.facts.length > 0 ? retainedCount / hidden.facts.length : null

  const matchedRecords = new Set<string>()
  for (const fact of hidden.facts) {
    const m = bestMatch(fact.text, artifacts.records)
    if (m) matchedRecords.add(m.id)
  }
  const precision =
    artifacts.records.length > 0 ? matchedRecords.size / artifacts.records.length : null

  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null

  const falseClaims: string[] = []
  const haystack = [artifacts.renderText ?? "", ...artifacts.records.map((r) => r.text)]
    .map(normalizeText)
    .join("\n")
  for (const banned of hidden.mustNotAppear) {
    if (normalizeText(banned) && haystack.includes(normalizeText(banned))) {
      falseClaims.push(banned)
    }
  }

  return { precision, recall, f1, scored, criticalOmissions, wrongInvalidations, unresolvedOpenItems, falseClaims }
}
