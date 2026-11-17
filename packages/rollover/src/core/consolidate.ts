/** Consolidation result validation (spec Part A §7.5). */
import type { LedgerInvalidation } from "./types"

export type ConsolidationResult = { invalidate: LedgerInvalidation[] } | { error: string }

export function validateConsolidation(
  raw: unknown,
  snapshotIds: Set<string>,
  correctionIds: Set<string>,
): ConsolidationResult {
  if (typeof raw !== "object" || raw === null) return { error: "invalid input" }
  const obj = raw as { invalidate?: unknown }
  if (!Array.isArray(obj.invalidate)) return { error: "invalidate must be an array" }

  const out: LedgerInvalidation[] = []
  const seen = new Set<string>()
  for (const entry of obj.invalidate) {
    if (typeof entry !== "object" || entry === null) return { error: "bad entry" }
    const e = entry as { id?: unknown; reason?: unknown; by?: unknown }
    if (typeof e.id !== "string" || !snapshotIds.has(e.id)) return { error: `unknown id: ${String(e.id)}` }
    if (e.reason !== "superseded" && e.reason !== "resolved" && e.reason !== "duplicate") return { error: `bad reason: ${String(e.reason)}` }
    if (typeof e.by !== "string" || !snapshotIds.has(e.by)) return { error: `unknown by: ${String(e.by)}` }
    if (e.by === e.id) return { error: "by must differ from id" }
    // user_correction may be invalidated only by another user_correction
    if (correctionIds.has(e.id) && !correctionIds.has(e.by)) return { error: "correction requires correction" }
    if (seen.has(e.id)) return { error: `duplicate entry: ${e.id}` }
    seen.add(e.id)
    out.push({ kind: "invalidate", id: e.id, reason: e.reason, by: e.by, at: Date.now() })
  }
  return { invalidate: out }
}
