import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"

export type SummaryDiff = SnapshotFileDiff & { file: string }

export function isSummaryDiff(value: SnapshotFileDiff): value is SummaryDiff {
  return typeof value.file === "string"
}

/**
 * Collapse a message's summary diffs to one entry per file, keeping the last
 * occurrence of each file in original order.
 *
 * Uses a Set for O(n) dedup. The previous implementation scanned the result
 * array with `.some()` on every entry (O(n^2)), which could hang the renderer
 * on messages with tens of thousands of diffs.
 */
export function dedupeSummaryDiffs(diffs: SnapshotFileDiff[] | undefined): SummaryDiff[] {
  const seen = new Set<string>()
  const result: SummaryDiff[] = []
  const source = diffs ?? []
  for (let i = source.length - 1; i >= 0; i--) {
    const diff = source[i]
    if (!isSummaryDiff(diff)) continue
    if (seen.has(diff.file)) continue
    seen.add(diff.file)
    result.push(diff)
  }
  return result.reverse()
}
