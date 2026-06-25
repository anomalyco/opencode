const MAX_SUMMARY_DIFFS = 200

export function limitSummaryDiffs<T>(diffs: T[]) {
  // Keep turn summaries bounded so a pathological workspace diff cannot bloat message JSON.
  if (diffs.length <= MAX_SUMMARY_DIFFS) return diffs
  return diffs.slice(0, MAX_SUMMARY_DIFFS)
}
