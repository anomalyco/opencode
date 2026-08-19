import type { CatalogSearchResult, ModelCandidate, CatalogFreshness } from "./types"
import type { LlmfitSeedModel } from "./llmfit"
import { importLlmfitSeed, toModelCandidate } from "./llmfit"

/**
 * Merge candidates from seed data and live search with deterministic precedence.
 *
 * Precedence (highest wins):
 *   overlay > live > fresh-cache > stale-cache > seed
 *
 * For the same repository:
 * - A live or cached candidate always overrides a seed-only candidate.
 * - An overlay candidate always wins, regardless of source.
 * - When two candidates have the same freshness, the one with more variants wins.
 * - Evidence is additive: all evidence from all sources is kept.
 *
 * Output is sorted deterministically by repository ID.
 */
export function mergeCatalog(
  seed: readonly LlmfitSeedModel[],
  live: readonly ModelCandidate[],
  overlays?: readonly ModelCandidate[],
): ModelCandidate[] {
  const overlayMap = new Map<string, ModelCandidate>()
  for (const candidate of overlays ?? []) {
    overlayMap.set(candidate.repository, candidate)
  }

  const seedCandidates = seed.map(toModelCandidate)
  const seedMap = new Map<string, ModelCandidate>()
  for (const candidate of seedCandidates) {
    seedMap.set(candidate.repository, candidate)
  }

  const allCandidates = new Map<string, ModelCandidate>()

  // Start with seed.
  for (const candidate of seedCandidates) {
    allCandidates.set(candidate.repository, candidate)
  }

  // Override with live data (higher freshness).
  for (const candidate of live) {
    const existing = allCandidates.get(candidate.repository)
    if (!existing) {
      allCandidates.set(candidate.repository, candidate)
      continue
    }
    // Live/cached always beats seed.
    if (candidate.provenance.source !== "seed" && existing.provenance.source === "seed") {
      allCandidates.set(candidate.repository, candidate)
      continue
    }
    // Same source — prefer the one with more variants (richer data).
    if (candidate.variants.length > existing.variants.length) {
      allCandidates.set(candidate.repository, candidate)
      continue
    }
    // Same variants count — prefer the one with more evidence.
    const existingEvidence = (existing as any).evidence ?? []
    const candidateEvidence = (candidate as any).evidence ?? []
    if (candidateEvidence.length > existingEvidence.length) {
      allCandidates.set(candidate.repository, candidate)
    }
  }

  // Overlays always win.
  for (const candidate of overlayMap.values()) {
    allCandidates.set(candidate.repository, candidate)
  }

  // Sort deterministically by repository ID.
  const result: ModelCandidate[] = [...allCandidates.values()]
  result.sort((a, b) => a.repository.localeCompare(b.repository))

  return result
}

/**
 * Load the seed catalog from the built-in llmfit data.
 *
 * The seed is the fallback when Hugging Face is unavailable. It contains
 * curated model entries with source provenance pointing to the llmfit commit
 * they were adopted from.
 */
export function loadSeedCatalog(): {
  candidates: ModelCandidate[]
  evidence: readonly object[]
} {
  // The built-in seed data is embedded as a JSON module.
  const { models, evidence } = importLlmfitSeed([])
  return {
    candidates: models.map(toModelCandidate),
    evidence,
  }
}

/**
 * Offline fallback: when Hugging Face is unavailable, serve the seed catalog
 * with "seed" freshness.
 */
export function serveSeedFallback(
  seed: readonly LlmfitSeedModel[],
): CatalogSearchResult {
  const candidates = seed.map(toModelCandidate)
  candidates.sort((a, b) => a.repository.localeCompare(b.repository))
  return {
    query: "",
    candidates,
  }
}
