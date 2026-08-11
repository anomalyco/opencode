// Gallery state classification (model-gallery-ui task 5.6).
//
// Every (candidate, host) row gets exactly one label, because the UI shows one
// badge. The interesting part is not the labels but their PRECEDENCE: several
// are true at once for most rows, and picking the wrong one tells the user to
// fix the wrong thing.
//
// The order below is "most fundamental first" — the same principle Skein's
// placement port uses. A host that is offline is also, technically, a host
// where nothing fits and nothing is installed; reporting any of those instead
// of "offline" sends the user hunting for a model problem when they have a
// network problem.

import { modelFamilyVersion } from "../model-catalog/family"
import type { ModelCandidate } from "../model-catalog/types"
import type { GalleryRow } from "./join"

export type GalleryState =
  /** The host already serves this candidate. */
  | "installed"
  /** Same family as something installed here, but a newer version. */
  | "upgrade"
  /** A family this host has nothing from. */
  | "fresh"
  /** Shown from cached catalog data that is past its freshness window. */
  | "stale"
  /** The host did not answer discovery. */
  | "offline"
  /** Catalog policy rejects it, or nothing about it fits this host. */
  | "unsupported"
  /** llama-skein could not be asked, so no claim can be made. */
  | "unknown"

export type Classification = {
  state: GalleryState
  /** Human-facing context. Never parsed. */
  detail: string
  /** For "upgrade", the installed model this would replace. */
  replaces?: string
}

/**
 * Label one row.
 *
 * Precedence, most fundamental first:
 *   1. offline      — nothing else about the host can be trusted
 *   2. unsupported  — a policy refusal is a fact about the candidate, and a
 *                     known no-fit is a fact about the pair; neither improves
 *   3. installed    — already here, so upgrade/fresh do not apply
 *   4. unknown      — we could not ask; say so rather than guess fresh
 *   5. stale        — we can answer, but from data past its freshness window
 *   6. upgrade / fresh
 *
 * "unknown" deliberately outranks "stale" and the family labels: claiming a
 * model is a fresh find on a host we could not query is an invention, whereas
 * admitting we do not know is always true.
 */
export function classifyRow(
  row: GalleryRow,
  candidate: Pick<ModelCandidate, "policy" | "provenance">,
  installedOnHost: readonly string[] = [],
): Classification {
  if (!row.online) {
    return { state: "offline", detail: `${row.hostName} did not answer` }
  }

  if (!candidate.policy.allowed) {
    const why = candidate.policy.reasons[0] ?? "rejected by catalog policy"
    return { state: "unsupported", detail: why }
  }

  if (row.installed) {
    return { state: "installed", detail: `already served by ${row.hostName}` }
  }

  if (row.fitKnown && !row.bestVariant) {
    return { state: "unsupported", detail: `no variant fits ${row.hostName}` }
  }

  if (!row.fitKnown) {
    return { state: "unknown", detail: `${row.hostName} could not report fit` }
  }

  if (candidate.provenance.freshness === "stale-cache") {
    return { state: "stale", detail: "shown from cached catalog data past its freshness window" }
  }

  const upgrade = findUpgrade(row.candidateId, installedOnHost)
  if (upgrade) {
    return { state: "upgrade", detail: `newer than ${upgrade}`, replaces: upgrade }
  }

  return { state: "fresh", detail: `no ${familyLabel(row.candidateId)} model on ${row.hostName}` }
}

/**
 * The installed model this candidate would supersede, or null.
 *
 * Reuses model-catalog/family's version parsing rather than reimplementing it,
 * so the gallery and the catalog cannot disagree about whether Qwen3.6 is
 * newer than Qwen3 — including the two Skein defects that were deliberately
 * fixed there (see the adoption manifest).
 */
function findUpgrade(candidateId: string, installedOnHost: readonly string[]): string | null {
  const candidateVersion = modelFamilyVersion(candidateId)
  if (!candidateVersion) return null

  let best: { name: string; version: number } | null = null
  for (const installed of installedOnHost) {
    const parsed = modelFamilyVersion(installed)
    if (!parsed || parsed.family !== candidateVersion.family) continue
    if (parsed.version >= candidateVersion.version) return null // same or better already here
    if (!best || parsed.version > best.version) best = { name: installed, version: parsed.version }
  }
  return best?.name ?? null
}

function familyLabel(candidateId: string): string {
  return modelFamilyVersion(candidateId)?.family ?? "matching"
}
