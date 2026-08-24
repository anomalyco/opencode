// Resolving candidate ids into catalog candidates for the gallery API.
//
// A thin seam on purpose. The catalog already knows how to resolve a
// repository, fall back to the seed, and record provenance; this only decides
// which of those the gallery asks for and guarantees the HTTP layer never sees
// an exception from one bad id.

import { createHuggingFaceCatalog } from "../model-catalog/huggingface"
import { loadSeedCatalog } from "../model-catalog/seed"
import type { ModelCandidate } from "../model-catalog/types"

export type LoadCandidatesOptions = {
  /** Injected in tests. */
  resolve?: (repository: string) => Promise<ModelCandidate>
  /** Injected in tests; defaults to the bundled seed catalog. */
  seed?: () => readonly ModelCandidate[]
}

/**
 * Resolve each id to a candidate, preferring live catalog data and falling back
 * to the seed.
 *
 * One unresolvable id must not empty the gallery: ids are resolved
 * independently and failures are skipped, because a single renamed or deleted
 * repository in a list of twenty is a normal occurrence, not a reason to show
 * the user nothing. The resulting list is therefore allowed to be shorter than
 * the request, and callers must not assume index alignment.
 */
export async function loadCatalogCandidates(
  ids: readonly string[],
  options: LoadCandidatesOptions = {},
): Promise<ModelCandidate[]> {
  if (ids.length === 0) return []

  const resolve = options.resolve ?? defaultResolve()
  const seedIndex = new Map<string, ModelCandidate>()
  for (const candidate of options.seed?.() ?? loadSeedCandidates()) {
    seedIndex.set(candidate.id, candidate)
    seedIndex.set(candidate.repository, candidate)
  }

  const settled = await Promise.allSettled(ids.map((id) => resolve(id)))
  const out: ModelCandidate[] = []
  const seen = new Set<string>()
  for (const [index, result] of settled.entries()) {
    const id = ids[index]!
    const candidate = result.status === "fulfilled" ? result.value : seedIndex.get(id)
    if (!candidate || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    out.push(candidate)
  }
  return out
}

function defaultResolve() {
  const catalog = createHuggingFaceCatalog()
  return (repository: string) => catalog.resolve({ repository })
}

function loadSeedCandidates(): readonly ModelCandidate[] {
  try {
    return loadSeedCatalog().candidates
  } catch {
    // A missing or malformed seed file must not take the gallery down; live
    // resolution still works without it.
    return []
  }
}
