import type { GroundedOutput, EvidenceRef } from "./types"

export type DataProvider = (source: string) => string | null

export function verifyEvidence(output: GroundedOutput, getData: DataProvider): { ok: true } | { ok: false; reason: string } {
  const record = getData(output.evidence.source)
  if (record === null)
    return { ok: false, reason: `Evidence source '${output.evidence.source}' not found in database` }

  const start = output.evidence.offset
  const end = start + output.evidence.length

  if (start < 0 || start >= record.length)
    return { ok: false, reason: `Evidence offset ${start} out of range (data length ${record.length})` }

  if (end > record.length)
    return { ok: false, reason: `Evidence length ${output.evidence.length} exceeds data at offset ${start}` }

  const excerpt = record.slice(start, end)
  const claimPrefix = output.claim.slice(0, 80)

  if (!excerpt.includes(claimPrefix))
    return { ok: false, reason: `Claim '${claimPrefix}...' not found in evidence excerpt` }

  return { ok: true }
}

export function extractEvidenceFromSource(source: string, ref: EvidenceRef): string | null {
  if (ref.offset < 0 || ref.offset >= source.length) return null
  return source.slice(ref.offset, ref.offset + ref.length)
}
