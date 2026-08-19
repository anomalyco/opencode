// Hard compatibility filters (model-gallery-ui task 5.4).
//
// "Hard" means disqualifying fact, not preference. A model that cannot run on a
// host is not a low-scoring option — it is not an option, and it must be taken
// out before ranking rather than ranked last. Two reasons that matters:
//
//   - Ranking weights are tuned against plausible options. Leaving impossible
//     ones in distorts every relative score around them.
//   - "Ranked last" and "cannot run" read identically in a sorted list, so a
//     user scrolling to the bottom sees a suggestion the machine cannot honour.
//
// Everything here is therefore a boolean fact about the pair, never a
// judgement. Judgement is task 5.5.

import type { ModelCandidate } from "../model-catalog/types"
import type { GalleryRow } from "./join"

/** Stable codes; callers branch on these and tests assert on them. */
export type IncompatibilityReason =
  /** The catalog's own policy rejected the candidate (format, gating, licence). */
  | "policy-blocked"
  /** No variant of this candidate fits this host. */
  | "no-fitting-variant"
  /** The host did not answer, so nothing about it can be asserted. */
  | "host-offline"
  /** The candidate lacks a capability the caller requires. */
  | "capability-missing"
  /** No variant reaches the minimum context the caller requires. */
  | "context-too-small"

export type CompatibilityRequirements = {
  requiredCapabilities?: readonly string[]
  minContext?: number
}

export type CompatibilityVerdict = {
  compatible: boolean
  reasons: IncompatibilityReason[]
}

/**
 * Decide whether a (candidate, host) pair is worth ranking at all.
 *
 * An UNKNOWN fit does not disqualify. When llama-skein could not be asked, the
 * honest position is that we do not know the model fails — filtering it out
 * would hide a perfectly good option because a host runs an older build, and
 * the user would have no way to tell the difference from the model not
 * existing. Task 5.6 labels such rows "unknown" so the UI can be explicit.
 *
 * All applicable reasons are collected rather than short-circuiting: an
 * explanation naming one of three problems invites the user to fix it and find
 * the pair still unavailable.
 */
export function hardCompatibility(
  row: GalleryRow,
  candidate: Pick<ModelCandidate, "policy" | "capabilities">,
  requirements: CompatibilityRequirements = {},
): CompatibilityVerdict {
  const reasons: IncompatibilityReason[] = []

  if (!candidate.policy.allowed) reasons.push("policy-blocked")
  if (!row.online) reasons.push("host-offline")

  for (const needed of requirements.requiredCapabilities ?? []) {
    if (!candidate.capabilities.includes(needed)) {
      reasons.push("capability-missing")
      break
    }
  }

  // Only assert about fit when there is a verdict to assert from.
  if (row.fitKnown) {
    if (!row.bestVariant) {
      reasons.push("no-fitting-variant")
    } else if (requirements.minContext && row.bestVariant.maxFitCtx > 0) {
      // A fitting variant whose ceiling is below the caller's floor is as
      // unusable as one that does not fit at all.
      const reachable = row.variants.some(
        (v) => v.maxFitCtx >= requirements.minContext! && v.fitLevel !== "no" && v.fitLevel !== "unknown",
      )
      if (!reachable) reasons.push("context-too-small")
    }
  }

  return { compatible: reasons.length === 0, reasons }
}

/** Keep only the rows worth ranking, preserving order. */
export function filterCompatible<T extends { row: GalleryRow; candidate: Pick<ModelCandidate, "policy" | "capabilities"> }>(
  entries: readonly T[],
  requirements: CompatibilityRequirements = {},
): T[] {
  return entries.filter((e) => hardCompatibility(e.row, e.candidate, requirements).compatible)
}
