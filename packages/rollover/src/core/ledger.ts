/** Ledger helpers: active records, id counters, dedupe (spec Part A §4.4, §7.4). */
import type { LedgerLine, LedgerRecord, RecordType } from "./types"

const PREFIX: Record<RecordType, string> = {
  objective: "o",
  decision: "d",
  user_correction: "c",
  open_item: "i",
  verification: "v",
}

export function recordPrefix(type: RecordType): string {
  return PREFIX[type]
}

/** A record is valid when no invalidation line names it. */
export function activeRecords(lines: LedgerLine[]): LedgerRecord[] {
  const invalidated = new Set(lines.filter((l) => l.kind === "invalidate").map((l) => l.id))
  return lines.filter((l): l is LedgerRecord => l.kind === "record" && !invalidated.has(l.id))
}

export function nextRecordId(lines: LedgerLine[], type: RecordType): string {
  const prefix = PREFIX[type]
  let max = 0
  for (const line of lines) {
    const id = line.id
    if (!id.startsWith(prefix)) continue
    const n = Number(id.slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

export function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
}

/** Same type + normalized text in the last `lookback` active records → duplicate. */
export function isDuplicate(rec: { type: RecordType; text: string }, active: LedgerRecord[], lookback = 30): boolean {
  const normalized = normalizeForDedupe(rec.text)
  return active
    .slice(-lookback)
    .some((existing) => existing.type === rec.type && normalizeForDedupe(existing.text) === normalized)
}

export function pushCap<T>(arr: readonly T[], item: T, cap: number): T[] {
  const next = [...arr, item]
  return next.length > cap ? next.slice(next.length - cap) : next
}
