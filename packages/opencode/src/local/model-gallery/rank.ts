// Explained ranking (model-gallery-ui task 5.5).
//
// The requirement is "explained", and that word does the work. A gallery that
// emits a single number tells the user nothing they can act on: they cannot
// tell a model that ranked low because it barely fits from one that ranked low
// because nobody downloads it, and those call for opposite responses (pick a
// smaller quant vs. ignore the signal).
//
// So ranking here produces a list of named, signed contributions and a total
// that is exactly their sum. The UI can show the total, the top contributor, or
// the whole breakdown, and none of those can drift from each other.
//
// Weights are a starting point, not a tuned model. They encode one ordering
// claim the epic does make explicitly — compatibility and context beat
// popularity — and are deliberately coarse elsewhere. Reuses llmfit's
// quality/speed tables rather than inventing parallel ones.

import { quantQualityPenalty, quantSpeedMultiplier, generationQualityBonus } from "../model-catalog/quant"
import type { ModelCandidate, ModelEvidence } from "../model-catalog/types"
import type { GalleryRow } from "./join"

/** One named contribution to a candidate's score on a host. */
export type ScoreComponent = {
  kind: ModelEvidence["kind"]
  /** Signed contribution to the total. */
  points: number
  /** Why, in one phrase. Shown to the user. */
  detail: string
  /** False when the input was inferred rather than measured on this host. */
  measured: boolean
}

export type RankedRow = {
  row: GalleryRow
  score: number
  components: ScoreComponent[]
}

export type RankOptions = {
  /** Context the user actually wants; scores the fit/context dimension. */
  desiredContext?: number
  /** ISO date used for recency. Injected so tests are not time-dependent. */
  now?: Date
  /** Candidate release date (ISO), when the catalog knows one. */
  releaseDate?: string | null
}

const FIT_POINTS: Record<string, number> = { perfect: 40, good: 32, tight: 18, marginal: 8 }

/**
 * Score one already-filtered row. Callers must apply task 5.4's hard filters
 * first — this assumes the pair is possible and only asks how good it is.
 */
export function scoreRow(
  row: GalleryRow,
  candidate: Pick<ModelCandidate, "downloads" | "likes" | "capabilities" | "provenance" | "architecture" | "name">,
  options: RankOptions = {},
): RankedRow {
  const components: ScoreComponent[] = []
  const best = row.bestVariant

  // Fit dominates: a model that barely fits is worse than one that fits well,
  // regardless of how popular either is.
  if (row.fitKnown && best) {
    components.push({
      kind: "fit",
      points: FIT_POINTS[best.fitLevel] ?? 0,
      detail: `${best.variantName} fits ${row.hostName} (${best.fitLevel})`,
      measured: true,
    })
  } else {
    // Not a penalty for being bad — a penalty for being unverifiable. A host
    // that cannot report fit should lose to one that can and said yes.
    components.push({
      kind: "fit",
      points: 0,
      detail: `${row.hostName} could not report fit`,
      measured: false,
    })
  }

  // Context, relative to what the user asked for. Headroom beyond the request
  // is not worth more points; falling short is worth fewer.
  if (best && best.maxFitCtx > 0) {
    const wanted = options.desiredContext ?? 0
    const ratio = wanted > 0 ? Math.min(1, best.maxFitCtx / wanted) : 1
    components.push({
      kind: "context",
      points: Math.round(20 * ratio),
      detail: wanted > 0 ? `${best.maxFitCtx} of ${wanted} tokens requested` : `${best.maxFitCtx} tokens`,
      measured: true,
    })
  }

  // Quality and speed come from llmfit's tables, keyed on the variant that
  // would actually be installed — not on the candidate in the abstract.
  if (best) {
    const generationBonus = generationQualityBonus(candidate.architecture ?? null, candidate.name)
    components.push({
      kind: "quality",
      points: Math.round(quantQualityPenalty(best.variantName) + generationBonus),
      detail: `${best.variantName} quantization, generation bonus ${generationBonus.toFixed(1)}`,
      measured: false,
    })
    components.push({
      kind: "speed",
      points: Math.round((quantSpeedMultiplier(best.variantName) - 1) * 10),
      detail: `${best.variantName} runs at ${quantSpeedMultiplier(best.variantName).toFixed(2)}x baseline`,
      measured: false,
    })
  }

  if (candidate.capabilities.length > 0) {
    components.push({
      kind: "capability",
      points: Math.min(6, candidate.capabilities.length * 2),
      detail: candidate.capabilities.join(", "),
      measured: false,
    })
  }

  // Provenance: a live catalog answer is worth more than a seed guess, because
  // the seed may describe a model that no longer exists in that shape.
  const freshnessPoints: Record<string, number> = { live: 5, "fresh-cache": 4, "stale-cache": 1, seed: 0 }
  components.push({
    kind: "provenance",
    points: freshnessPoints[candidate.provenance.freshness] ?? 0,
    detail: `${candidate.provenance.source} (${candidate.provenance.freshness})`,
    measured: false,
  })

  if (options.releaseDate) {
    const months = monthsBetween(options.releaseDate, options.now ?? new Date())
    if (months !== null) {
      // Newer is better, decaying to zero over two years. Model quality per
      // parameter has improved fast enough that age is a real signal.
      const points = Math.max(0, Math.round(8 * (1 - months / 24)))
      components.push({
        kind: "recency",
        points,
        detail: `released ~${months} month(s) ago`,
        measured: false,
      })
    }
  }

  // Popularity last and smallest: it is the weakest evidence of whether a model
  // suits THIS user on THIS machine, and the epic is explicit that
  // compatibility and context must outrank it.
  const popularity = Math.min(5, Math.round(Math.log10(Math.max(1, candidate.downloads)) ))
  components.push({
    kind: "popularity",
    points: popularity,
    detail: `${candidate.downloads} downloads, ${candidate.likes} likes`,
    measured: false,
  })

  return { row, score: components.reduce((sum, c) => sum + c.points, 0), components }
}

/**
 * Rank rows, best first. Ties break on host id so the order is stable between
 * refreshes rather than shuffling under the user.
 */
export function rankRows(
  entries: readonly {
    row: GalleryRow
    candidate: Parameters<typeof scoreRow>[1]
    options?: RankOptions
  }[],
): RankedRow[] {
  return entries
    .map((e) => scoreRow(e.row, e.candidate, e.options))
    .sort((a, b) => b.score - a.score || a.row.hostId.localeCompare(b.row.hostId))
}

function monthsBetween(iso: string, now: Date): number | null {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
  return Math.max(0, months)
}
